import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson, userSnapshot, UserRow } from '../db/database.js';
import { authMiddleware, AuthRequest, createNotification } from '../middleware/auth.js';

const router = Router();

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

  // Remove follows nos dois sentidos
  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user!.id, userId);
  await db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(userId, req.user!.id);

  res.status(201).json({ ok: true });
});

router.delete('/block/:userId', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  await db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user!.id, req.params.userId);
  res.json({ ok: true });
});

router.post('/friendships', authMiddleware, async (req: AuthRequest, res) => {
  const { receiver_id } = req.body;
  if (!receiver_id || receiver_id === req.user!.id) return res.status(400).json({ error: 'Destinatário inválido' });

  const db = await getDb();
  const existing = await db.prepare(
    `SELECT * FROM friendships WHERE
     (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`
  ).get(req.user!.id, receiver_id, receiver_id, req.user!.id);
  if (existing) return res.status(409).json({ error: 'Solicitação já existe' });

  const id = uuid();
  await db.prepare('INSERT INTO friendships (id, requester_id, receiver_id, status) VALUES (?, ?, ?, ?)').run(
    id, req.user!.id, receiver_id, 'pending'
  );
  await createNotification(receiver_id, req.user!.id, 'friendship_request', 'user', req.user!.id);
  res.status(201).json({ id, status: 'pending' });
});

router.patch('/friendships/:id', authMiddleware, async (req: AuthRequest, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status inválido' });

  const db = await getDb();
  const friendship = await db.prepare('SELECT * FROM friendships WHERE id = ?').get(req.params.id) as
    | { receiver_id: string; requester_id: string }
    | undefined;
  if (!friendship) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (friendship.receiver_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });

  await db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run(status, req.params.id);
  if (status === 'accepted') {
    await createNotification(friendship.requester_id, req.user!.id, 'friendship_accepted', 'user', req.user!.id);
  }
  res.json({ ok: true, status });
});

router.get('/friendships', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const friendships = await db.prepare(
    `SELECT f.*, u.username, u.full_name, u.avatar_url FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.receiver_id ELSE f.requester_id END
     WHERE (f.requester_id = ? OR f.receiver_id = ?) AND f.status = 'accepted'`
  ).all(req.user!.id, req.user!.id, req.user!.id);
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
