import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson, userSnapshot, UserRow } from '../db/database.js';
import { authMiddleware, AuthRequest, createNotification } from '../middleware/auth.js';

const router = Router();

type FriendshipRow = {
  id: string;
  requester_id: string;
  receiver_id: string;
  status: string;
  created_at?: string;
};

async function findFriendship(db: Awaited<ReturnType<typeof getDb>>, a: string, b: string) {
  return (await db.prepare(
    `SELECT * FROM friendships WHERE
     (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`
  ).get(a, b, b, a)) as FriendshipRow | undefined;
}

function friendshipStatusForViewer(row: FriendshipRow | undefined, meId: string) {
  if (!row) return { friendship_status: 'none' as const, friendship_id: null as string | null };
  if (row.status === 'accepted') {
    return { friendship_status: 'friends' as const, friendship_id: row.id };
  }
  if (row.status === 'pending') {
    if (row.requester_id === meId) {
      return { friendship_status: 'pending_sent' as const, friendship_id: row.id };
    }
    return { friendship_status: 'pending_received' as const, friendship_id: row.id };
  }
  return { friendship_status: 'none' as const, friendship_id: null as string | null };
}

router.post('/follow/:userId', authMiddleware, async (req: AuthRequest, res) => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (userId === req.user!.id) return res.status(400).json({ error: 'Não pode seguir a si mesmo' });
  const db = await getDb();
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

  const blocked = await db.prepare(
    `SELECT id FROM blocks WHERE
     (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`
  ).get(req.user!.id, userId, userId, req.user!.id);
  if (blocked) return res.status(403).json({ error: 'Não é possível seguir este usuário' });

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) as UserRow;
  try {
    await db.prepare('INSERT INTO follows (id, follower_id, following_id, follower_snapshot) VALUES (?, ?, ?, ?)').run(
      uuid(), user.id, userId, userSnapshot(user)
    );
    await createNotification(userId, user.id, 'follow', 'user', user.id);
  } catch {
    return res.status(409).json({ error: 'Já segue este usuário' });
  }
  res.status(201).json({ ok: true });
});

router.delete('/follow/:userId', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user!.id, req.params.userId);
  res.json({ ok: true });
});

router.post('/block/:userId', authMiddleware, async (req: AuthRequest, res) => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  if (userId === req.user!.id) return res.status(400).json({ error: 'Não pode bloquear a si mesmo' });

  const db = await getDb();
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

  try {
    await db.prepare('INSERT INTO blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)').run(
      uuid(), req.user!.id, userId
    );
  } catch {
    return res.status(409).json({ error: 'Usuário já bloqueado' });
  }

  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user!.id, userId);
  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(userId, req.user!.id);
  await db.prepare(
    `DELETE FROM friendships WHERE
     (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`
  ).run(req.user!.id, userId, userId, req.user!.id);

  res.status(201).json({ ok: true });
});

router.delete('/block/:userId', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  await db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user!.id, req.params.userId);
  res.json({ ok: true });
});

router.get('/friendships/status/:userId', authMiddleware, async (req: AuthRequest, res) => {
  const userId = String(req.params.userId);
  if (userId === req.user!.id) {
    return res.json({ friendship_status: 'self', friendship_id: null });
  }
  const db = await getDb();
  const row = await findFriendship(db, req.user!.id, userId);
  res.json(friendshipStatusForViewer(row, req.user!.id));
});

router.post('/friendships', authMiddleware, async (req: AuthRequest, res) => {
  const { receiver_id } = req.body;
  if (!receiver_id || receiver_id === req.user!.id) return res.status(400).json({ error: 'Destinatário inválido' });

  const db = await getDb();
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(receiver_id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

  const blocked = await db.prepare(
    `SELECT id FROM blocks WHERE
     (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`
  ).get(req.user!.id, receiver_id, receiver_id, req.user!.id);
  if (blocked) return res.status(403).json({ error: 'Não é possível adicionar este usuário' });

  const existing = await findFriendship(db, req.user!.id, receiver_id);

  if (existing?.status === 'accepted') {
    return res.status(409).json({ error: 'Já são amigos', id: existing.id, status: 'accepted' });
  }
  if (existing?.status === 'pending') {
    return res.status(409).json({
      error: 'Solicitação já existe',
      id: existing.id,
      status: 'pending',
      friendship_status: friendshipStatusForViewer(existing, req.user!.id).friendship_status,
    });
  }

  // Rejeitado antes: reabre como novo pedido (quem pede agora é o requester)
  if (existing?.status === 'rejected') {
    await db.prepare(
      `UPDATE friendships SET requester_id = ?, receiver_id = ?, status = 'pending' WHERE id = ?`
    ).run(req.user!.id, receiver_id, existing.id);
    await createNotification(receiver_id, req.user!.id, 'friendship_request', 'friendship', existing.id);
    return res.status(201).json({ id: existing.id, status: 'pending' });
  }

  const id = uuid();
  await db.prepare('INSERT INTO friendships (id, requester_id, receiver_id, status) VALUES (?, ?, ?, ?)').run(
    id, req.user!.id, receiver_id, 'pending'
  );
  await createNotification(receiver_id, req.user!.id, 'friendship_request', 'friendship', id);
  res.status(201).json({ id, status: 'pending' });
});

router.patch('/friendships/:id', authMiddleware, async (req: AuthRequest, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status inválido' });

  const db = await getDb();
  const friendship = (await db.prepare('SELECT * FROM friendships WHERE id = ?').get(req.params.id)) as
    | FriendshipRow
    | undefined;
  if (!friendship) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (friendship.receiver_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });
  if (friendship.status !== 'pending') return res.status(409).json({ error: 'Solicitação já respondida' });

  await db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'accepted') {
    await createNotification(friendship.requester_id, req.user!.id, 'friendship_accepted', 'user', req.user!.id);
  }
  res.json({ ok: true, status });
});

/** Cancelar pedido (requester), recusar (receiver via rejected), ou desfazer amizade (qualquer lado). */
router.delete('/friendships/:id', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const friendship = (await db.prepare('SELECT * FROM friendships WHERE id = ?').get(req.params.id)) as
    | FriendshipRow
    | undefined;
  if (!friendship) return res.status(404).json({ error: 'Solicitação não encontrada' });

  const me = req.user!.id;
  if (friendship.requester_id !== me && friendship.receiver_id !== me) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  await db.prepare('DELETE FROM friendships WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/friendships', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const me = req.user!.id;
  const filter = String(req.query.status || 'accepted');

  let sql = `
    SELECT f.*, u.id as user_id, u.username, u.full_name, u.avatar_url,
           CASE WHEN f.requester_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.receiver_id ELSE f.requester_id END
    WHERE (f.requester_id = ? OR f.receiver_id = ?)
  `;
  const params: string[] = [me, me, me, me];

  if (filter === 'accepted') {
    sql += ` AND f.status = 'accepted'`;
  } else if (filter === 'pending') {
    sql += ` AND f.status = 'pending'`;
  } else if (filter === 'pending_incoming') {
    sql += ` AND f.status = 'pending' AND f.receiver_id = ?`;
    params.push(me);
  } else if (filter === 'pending_outgoing') {
    sql += ` AND f.status = 'pending' AND f.requester_id = ?`;
    params.push(me);
  } else if (filter !== 'all') {
    return res.status(400).json({ error: 'Filtro inválido' });
  }

  sql += ` ORDER BY f.created_at DESC`;
  const friendships = await db.prepare(sql).all(...params);
  res.json(friendships);
});

router.get('/notifications', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const notifications = await db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user!.id);

  const actorIds = [...new Set(
    notifications.map((n) => (n as { actor_id: string }).actor_id).filter(Boolean)
  )];

  const followingSet = new Set<string>();
  const blockedSet = new Set<string>();
  const friendshipByActor = new Map<string, FriendshipRow>();

  if (actorIds.length) {
    const placeholders = actorIds.map(() => '?').join(',');
    const following = (await db.prepare(
      `SELECT following_id FROM follows WHERE follower_id = ? AND following_id IN (${placeholders})`
    ).all(req.user!.id, ...actorIds)) as { following_id: string }[];
    for (const row of following) followingSet.add(row.following_id);

    const blocked = (await db.prepare(
      `SELECT blocked_id FROM blocks WHERE blocker_id = ? AND blocked_id IN (${placeholders})`
    ).all(req.user!.id, ...actorIds)) as { blocked_id: string }[];
    for (const row of blocked) blockedSet.add(row.blocked_id);

    const friendships = (await db.prepare(
      `SELECT * FROM friendships WHERE
       (requester_id = ? AND receiver_id IN (${placeholders}))
       OR (receiver_id = ? AND requester_id IN (${placeholders}))`
    ).all(req.user!.id, ...actorIds, req.user!.id, ...actorIds)) as FriendshipRow[];
    for (const f of friendships) {
      const other = f.requester_id === req.user!.id ? f.receiver_id : f.requester_id;
      friendshipByActor.set(other, f);
    }
  }

  res.json(
    notifications.map((n) => {
      const row = n as {
        id: string;
        type: string;
        actor_id: string;
        target_type: string | null;
        target_id: string | null;
        actor_snapshot: string;
        created_at: string;
        is_read: number;
      };
      const snap = parseJson(row.actor_snapshot, {}) as {
        id?: string;
        full_name?: string;
        username?: string;
        avatar_url?: string;
      };
      const actorId = row.actor_id || snap.id || '';
      const friendship = friendshipByActor.get(actorId);
      const statusInfo = friendshipStatusForViewer(friendship, req.user!.id);
      return {
        id: row.id,
        type: row.type,
        actor_id: actorId,
        target_type: row.target_type,
        target_id: row.target_id,
        actor_snapshot: {
          id: actorId,
          full_name: snap.full_name || 'Usuário',
          username: snap.username || '',
          avatar_url: snap.avatar_url,
        },
        created_at: row.created_at,
        is_read: !!row.is_read,
        i_follow_actor: followingSet.has(actorId),
        actor_blocked: blockedSet.has(actorId),
        friendship_id: statusInfo.friendship_id || (row.type === 'friendship_request' ? row.target_id : null),
        friendship_status: statusInfo.friendship_status,
      };
    })
  );
});

router.get('/notifications/unread-count', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const result = (await db.prepare('SELECT COUNT(*)::int as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user!.id)) as { c: number };
  res.json({ count: result.c });
});

router.patch('/notifications/:id/read', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

router.patch('/notifications/read-all', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});

export default router;
