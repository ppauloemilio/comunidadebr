import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson } from '../db/database.js';
import { authMiddleware, AuthRequest, createNotification } from '../middleware/auth.js';
import type { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

export function setSocketIO(socketServer: SocketServer) {
  io = socketServer;
}

const router = Router();

type UserLite = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
};

async function loadUsersMap(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, UserLite>();
  if (!unique.length) return map;
  const db = await getDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = (await db.prepare(
    `SELECT id, username, full_name, avatar_url FROM users WHERE id IN (${placeholders})`
  ).all(...unique)) as UserLite[];
  for (const row of rows) map.set(row.id, row);
  return map;
}

function conversationPayload(
  c: Record<string, unknown>,
  meId: string,
  users: Map<string, UserLite>
) {
  const participantIds = parseJson(c.participant_ids as string, [] as string[]);
  const otherId = participantIds.find((id) => id !== meId) || participantIds[0] || '';
  const other = users.get(otherId) || null;
  const unread = parseJson(c.unread_count as string, {} as Record<string, number>);
  const lastMessage = parseJson(c.last_message as string | null, null) as {
    id?: string;
    content?: string;
    sender_id?: string;
    created_at?: string;
    attachment_url?: string | null;
  } | null;

  return {
    id: c.id,
    type: c.type,
    business_id: c.business_id,
    participant_ids: participantIds,
    other_user: other,
    last_message: lastMessage,
    unread: unread[meId] || 0,
    unread_count: unread,
    updated_at: c.updated_at,
    created_at: c.created_at,
  };
}

async function assertParticipant(conversationId: string, userId: string) {
  const db = await getDb();
  const conversation = (await db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId)) as
    | Record<string, unknown>
    | undefined;
  if (!conversation) return { error: 'Conversa não encontrada' as const, status: 404 as const };
  const participants = parseJson(conversation.participant_ids as string, [] as string[]);
  if (!participants.includes(userId)) return { error: 'Sem permissão' as const, status: 403 as const };
  return { conversation, participants };
}

async function insertMessage(opts: {
  conversationId: string;
  senderId: string;
  content: string;
  attachmentUrl?: string | null;
  participants: string[];
  unreadBase: Record<string, number>;
}) {
  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const content = opts.content.trim();
  const attachment = opts.attachmentUrl || null;

  await db.prepare(
    'INSERT INTO messages (id, conversation_id, sender_id, content, attachment_url) VALUES (?, ?, ?, ?, ?)'
  ).run(id, opts.conversationId, opts.senderId, content || (attachment ? '📎' : ''), attachment);

  const preview = content || (attachment ? '📎 Anexo' : '');
  const lastMessage = {
    id,
    content: preview,
    sender_id: opts.senderId,
    created_at: now,
    attachment_url: attachment,
  };
  const unread = { ...opts.unreadBase };
  for (const p of opts.participants) {
    if (p !== opts.senderId) unread[p] = (unread[p] || 0) + 1;
  }

  await db.prepare(
    'UPDATE conversations SET last_message = ?, unread_count = ?, updated_at = ?, hidden_for = ? WHERE id = ?'
  ).run(
    JSON.stringify(lastMessage),
    JSON.stringify(unread),
    now,
    JSON.stringify([]), // nova mensagem reabre a conversa para todos
    opts.conversationId
  );

  for (const p of opts.participants) {
    if (p !== opts.senderId) {
      await createNotification(p, opts.senderId, 'message', 'conversation', opts.conversationId);
    }
  }

  const message = await db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  io?.to(opts.conversationId).emit('new_message', message);
  return { ...(message as object), is_read: false, updated_at: null };
}

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const conversations = (await db.prepare(
    'SELECT * FROM conversations ORDER BY updated_at DESC'
  ).all()) as Record<string, unknown>[];

  const mine = conversations.filter((c) => {
    const participants = parseJson(c.participant_ids as string, [] as string[]);
    if (!participants.includes(req.user!.id)) return false;
    const hidden = parseJson(c.hidden_for as string | null, [] as string[]);
    return !hidden.includes(req.user!.id);
  });

  const allIds = mine.flatMap((c) => parseJson(c.participant_ids as string, [] as string[]));
  const users = await loadUsersMap(allIds);

  res.json(mine.map((c) => conversationPayload(c, req.user!.id, users)));
});

router.get('/unread-count', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const conversations = await db.prepare('SELECT unread_count, participant_ids, hidden_for FROM conversations').all();
  let total = 0;
  for (const c of conversations) {
    const participants = parseJson((c as { participant_ids: string }).participant_ids, [] as string[]);
    if (!participants.includes(req.user!.id)) continue;
    const hidden = parseJson((c as { hidden_for?: string }).hidden_for || '[]', [] as string[]);
    if (hidden.includes(req.user!.id)) continue;
    const unread = parseJson((c as { unread_count: string }).unread_count, {} as Record<string, number>);
    total += unread[req.user!.id] || 0;
  }
  res.json({ count: total });
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  const { participant_ids, type = 'user_user', business_id } = req.body;
  if (!participant_ids?.length) return res.status(400).json({ error: 'Participantes obrigatórios' });

  const allParticipants = [...new Set([req.user!.id, ...participant_ids])];
  const db = await getDb();

  const allConversations = (await db.prepare('SELECT * FROM conversations').all()) as Record<string, unknown>[];
  const existing = allConversations.find((c) => {
    const p = parseJson(c.participant_ids as string, [] as string[]).sort();
    const target = [...allParticipants].sort();
    return JSON.stringify(p) === JSON.stringify(target) && (c.type as string) === type;
  });

  const users = await loadUsersMap(allParticipants);

  if (existing) {
    // Reabrir se o usuário tinha excluído a conversa da lista
    const hidden = parseJson(existing.hidden_for as string | null, [] as string[]);
    if (hidden.includes(req.user!.id)) {
      const nextHidden = hidden.filter((id) => id !== req.user!.id);
      await db.prepare('UPDATE conversations SET hidden_for = ? WHERE id = ?').run(
        JSON.stringify(nextHidden),
        existing.id
      );
      existing.hidden_for = JSON.stringify(nextHidden);
    }
    return res.json(conversationPayload(existing, req.user!.id, users));
  }

  const id = uuid();
  const unread: Record<string, number> = {};
  for (const p of allParticipants) unread[p] = 0;

  await db.prepare(
    'INSERT INTO conversations (id, type, business_id, participant_ids, unread_count, hidden_for) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, type, business_id || null, JSON.stringify(allParticipants), JSON.stringify(unread), JSON.stringify([]));

  const conversation = (await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)) as Record<string, unknown>;
  res.status(201).json(conversationPayload(conversation, req.user!.id, users));
});

/** Exclui a conversa da lista do usuário atual (o outro participante continua vendo). */
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const conversationId = String(req.params.id);
  const checked = await assertParticipant(conversationId, req.user!.id);
  if ('error' in checked) return res.status(checked.status).json({ error: checked.error });

  const db = await getDb();
  const hidden = parseJson(
    (checked.conversation as { hidden_for?: string }).hidden_for || '[]',
    [] as string[]
  );
  if (!hidden.includes(req.user!.id)) hidden.push(req.user!.id);

  const unread = parseJson(
    (checked.conversation as { unread_count: string }).unread_count,
    {} as Record<string, number>
  );
  unread[req.user!.id] = 0;

  await db.prepare(
    'UPDATE conversations SET hidden_for = ?, unread_count = ? WHERE id = ?'
  ).run(JSON.stringify(hidden), JSON.stringify(unread), conversationId);

  io?.to(conversationId).emit('conversation_hidden', { id: conversationId, user_id: req.user!.id });
  res.json({ ok: true });
});

router.get('/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  const checked = await assertParticipant(String(req.params.id), req.user!.id);
  if ('error' in checked) return res.status(checked.status).json({ error: checked.error });

  const db = await getDb();
  const messages = await db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? AND is_deleted = 0 ORDER BY created_at ASC'
  ).all(req.params.id);

  const unread = parseJson(
    (checked.conversation as { unread_count: string }).unread_count,
    {} as Record<string, number>
  );
  unread[req.user!.id] = 0;
  await db.prepare('UPDATE conversations SET unread_count = ? WHERE id = ?').run(
    JSON.stringify(unread),
    req.params.id
  );

  await db.prepare(
    'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?'
  ).run(req.params.id, req.user!.id);

  res.json(
    messages.map((m) => ({
      ...m,
      is_read: !!(m as { is_read: number }).is_read,
      updated_at: (m as { updated_at?: string | null }).updated_at || null,
    }))
  );
});

router.post('/:id/messages', authMiddleware, async (req: AuthRequest, res) => {
  const { content = '', attachment_url } = req.body as {
    content?: string;
    attachment_url?: string;
  };
  if (!String(content || '').trim() && !attachment_url) {
    return res.status(400).json({ error: 'Mensagem vazia' });
  }

  const checked = await assertParticipant(String(req.params.id), req.user!.id);
  if ('error' in checked) return res.status(checked.status).json({ error: checked.error });

  const unreadBase = parseJson(
    (checked.conversation as { unread_count: string }).unread_count,
    {} as Record<string, number>
  );

  const message = await insertMessage({
    conversationId: String(req.params.id),
    senderId: req.user!.id,
    content: String(content || ''),
    attachmentUrl: attachment_url || null,
    participants: checked.participants,
    unreadBase,
  });

  res.status(201).json(message);
});

router.patch('/:id/messages/:messageId', authMiddleware, async (req: AuthRequest, res) => {
  const { content } = req.body as { content?: string };
  if (!content?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

  const conversationId = String(req.params.id);
  const messageId = String(req.params.messageId);
  const checked = await assertParticipant(conversationId, req.user!.id);
  if ('error' in checked) return res.status(checked.status).json({ error: checked.error });

  const db = await getDb();
  const message = (await db.prepare(
    'SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND is_deleted = 0'
  ).get(messageId, conversationId)) as
    | { id: string; sender_id: string; attachment_url: string | null }
    | undefined;
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (message.sender_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE messages SET content = ?, updated_at = ? WHERE id = ?`
  ).run(content.trim(), now, messageId);

  const last = parseJson(
    (checked.conversation as { last_message: string | null }).last_message,
    null
  ) as { id?: string } | null;
  if (last?.id === messageId) {
    await db.prepare(
      'UPDATE conversations SET last_message = ?, updated_at = ? WHERE id = ?'
    ).run(
      JSON.stringify({
        id: messageId,
        content: content.trim(),
        sender_id: req.user!.id,
        created_at: now,
        attachment_url: message.attachment_url,
      }),
      now,
      conversationId
    );
  }

  const updated = await db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  io?.to(conversationId).emit('message_updated', updated);
  res.json({ ...updated, is_read: true, updated_at: now });
});

router.delete('/:id/messages/:messageId', authMiddleware, async (req: AuthRequest, res) => {
  const conversationId = String(req.params.id);
  const messageId = String(req.params.messageId);
  const checked = await assertParticipant(conversationId, req.user!.id);
  if ('error' in checked) return res.status(checked.status).json({ error: checked.error });

  const db = await getDb();
  const message = (await db.prepare(
    'SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND is_deleted = 0'
  ).get(messageId, conversationId)) as { id: string; sender_id: string } | undefined;
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada' });
  if (message.sender_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });

  await db.prepare('UPDATE messages SET is_deleted = 1, content = ? WHERE id = ?').run('', messageId);

  const last = parseJson(
    (checked.conversation as { last_message: string | null }).last_message,
    null
  ) as { id?: string } | null;
  if (last?.id === messageId) {
    const previous = (await db.prepare(
      `SELECT id, content, sender_id, created_at, attachment_url FROM messages
       WHERE conversation_id = ? AND is_deleted = 0
       ORDER BY created_at DESC LIMIT 1`
    ).get(conversationId)) as
      | { id: string; content: string; sender_id: string; created_at: string; attachment_url: string | null }
      | undefined;
    const now = new Date().toISOString();
    await db.prepare(
      'UPDATE conversations SET last_message = ?, updated_at = ? WHERE id = ?'
    ).run(
      previous
        ? JSON.stringify({
            id: previous.id,
            content: previous.content || (previous.attachment_url ? '📎 Anexo' : ''),
            sender_id: previous.sender_id,
            created_at: previous.created_at,
            attachment_url: previous.attachment_url,
          })
        : null,
      now,
      conversationId
    );
  }

  io?.to(conversationId).emit('message_deleted', { id: messageId });
  res.json({ ok: true });
});

router.post('/:id/messages/:messageId/forward', authMiddleware, async (req: AuthRequest, res) => {
  const { conversation_id, participant_ids } = req.body as {
    conversation_id?: string;
    participant_ids?: string[];
  };

  const sourceConversationId = String(req.params.id);
  const messageId = String(req.params.messageId);
  const checked = await assertParticipant(sourceConversationId, req.user!.id);
  if ('error' in checked) return res.status(checked.status).json({ error: checked.error });

  const db = await getDb();
  const source = (await db.prepare(
    'SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND is_deleted = 0'
  ).get(messageId, sourceConversationId)) as
    | { content: string; attachment_url: string | null }
    | undefined;
  if (!source) return res.status(404).json({ error: 'Mensagem não encontrada' });

  let targetId = conversation_id;
  if (!targetId && participant_ids?.length) {
    const created = await apiCreateConversation(req.user!.id, participant_ids);
    targetId = created.id;
  }
  if (!targetId) return res.status(400).json({ error: 'Destino obrigatório' });

  const target = await assertParticipant(targetId, req.user!.id);
  if ('error' in target) return res.status(target.status).json({ error: target.error });

  const unreadBase = parseJson(
    (target.conversation as { unread_count: string }).unread_count,
    {} as Record<string, number>
  );

  const forwarded = await insertMessage({
    conversationId: targetId,
    senderId: req.user!.id,
    content: source.content?.startsWith('Encaminhada:')
      ? source.content
      : `Encaminhada: ${source.content || ''}`.trim(),
    attachmentUrl: source.attachment_url,
    participants: target.participants,
    unreadBase,
  });

  res.status(201).json({ message: forwarded, conversation_id: targetId });
});

async function apiCreateConversation(meId: string, participantIds: string[]) {
  const allParticipants = [...new Set([meId, ...participantIds])];
  const db = await getDb();
  const allConversations = (await db.prepare('SELECT * FROM conversations').all()) as Record<string, unknown>[];
  const existing = allConversations.find((c) => {
    const p = parseJson(c.participant_ids as string, [] as string[]).sort();
    const target = [...allParticipants].sort();
    return JSON.stringify(p) === JSON.stringify(target) && (c.type as string) === 'user_user';
  });
  if (existing) return { id: existing.id as string };

  const id = uuid();
  const unread: Record<string, number> = {};
  for (const p of allParticipants) unread[p] = 0;
  await db.prepare(
    'INSERT INTO conversations (id, type, business_id, participant_ids, unread_count, hidden_for) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, 'user_user', null, JSON.stringify(allParticipants), JSON.stringify(unread), JSON.stringify([]));
  return { id };
}

export default router;
