import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson, userSnapshot, UserRow, type Db } from '../db/database.js';
import { authMiddleware, AuthRequest, createNotification } from '../middleware/auth.js';

import { getMonetizationSettings, isPremiumProfile } from '../lib/settings.js';

const router = Router();

async function authorPremiumMap(db: Db, authorIds: string[]) {
  const unique = [...new Set(authorIds)];
  const map = new Map<string, boolean>();
  if (!unique.length) return map;
  const placeholders = unique.map(() => '?').join(',');
  const rows = (await db.prepare(
    `SELECT user_id, is_premium, premium_until FROM public_profiles WHERE user_id IN (${placeholders})`
  ).all(...unique)) as Array<{ user_id: string; is_premium: number; premium_until: string | null }>;
  for (const row of rows) {
    map.set(row.user_id, await isPremiumProfile(row));
  }
  return map;
}

async function formatPost(row: Record<string, unknown>, likedByMe = false, authorIsPremium = false) {
  const settings = await getMonetizationSettings();
  const promotedInDb = !!(row.is_promoted && (
    !row.promoted_until || new Date(row.promoted_until as string) >= new Date()
  ));
  const snapshot = parseJson(row.author_snapshot as string, {}) as Record<string, unknown>;
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    images: parseJson(row.images as string, []),
    author_id: row.author_id,
    business_id: row.business_id,
    country: row.country,
    likes_count: row.likes_count,
    comments_count: row.comments_count,
    is_active: row.is_active,
    is_promoted: settings.paid_posts_enabled && promotedInDb,
    author_is_premium: authorIsPremium,
    author_snapshot: { ...snapshot, is_premium: authorIsPremium },
    created_at: row.created_at,
    updated_at: row.updated_at || null,
    liked_by_me: likedByMe,
  };
}

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const profile = (await db.prepare('SELECT current_country FROM public_profiles WHERE user_id = ?').get(req.user!.id)) as
    | { current_country: string }
    | undefined;
  const country = profile?.current_country || 'BR';

  const history = (await db.prepare(
    'SELECT joined_at FROM user_country_history WHERE user_id = ? AND country = ?'
  ).get(req.user!.id, country)) as { joined_at: string } | undefined;

  let posts;
  if (history) {
    posts = await db.prepare(
      `SELECT * FROM posts WHERE is_active = 1 AND country = ? AND created_at >= ?
       ORDER BY
         CASE WHEN is_promoted = 1 AND (promoted_until IS NULL OR promoted_until >= datetime('now')) THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 50`
    ).all(country, history.joined_at);
  } else {
    posts = await db.prepare(
      `SELECT * FROM posts WHERE is_active = 1 AND country = ?
       ORDER BY
         CASE WHEN is_promoted = 1 AND (promoted_until IS NULL OR promoted_until >= datetime('now')) THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 50`
    ).all(country);
  }

  const likes = (await db.prepare('SELECT post_id FROM likes WHERE user_id = ?').all(req.user!.id)) as { post_id: string }[];
  const likedSet = new Set(likes.map((l) => l.post_id));

  const premiumByAuthor = await authorPremiumMap(
    db,
    posts.map((p) => p.author_id as string)
  );

  res.json(
    await Promise.all(
      posts.map((p) => formatPost(
        p as Record<string, unknown>,
        likedSet.has(p.id as string),
        premiumByAuthor.get(p.author_id as string) ?? false
      ))
    )
  );
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  const { content, type = 'text', images = [], business_id } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });

  const db = await getDb();
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) as UserRow;
  const profile = (await db.prepare('SELECT current_country, current_city FROM public_profiles WHERE user_id = ?').get(user.id)) as
    | { current_country: string; current_city: string }
    | undefined;

  const id = uuid();
  await db.prepare(
    `INSERT INTO posts (id, content, type, images, author_id, business_id, country, author_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    content.trim(),
    type,
    JSON.stringify(images),
    user.id,
    business_id || null,
    profile?.current_country || 'BR',
    userSnapshot({
      ...user,
      city: profile?.current_city,
      country: profile?.current_country,
    })
  );

  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  const premium = (await authorPremiumMap(db, [user.id])).get(user.id) ?? false;
  res.status(201).json(await formatPost(post as Record<string, unknown>, false, premium));
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)) as { author_id: string } | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (post.author_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });
  await db.prepare('UPDATE posts SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.patch('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const { content, images } = req.body as { content?: string; images?: string[] };
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(req.params.id)) as
    | Record<string, unknown>
    | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (post.author_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });

  const nextContent = content !== undefined ? String(content).trim() : String(post.content || '');
  if (!nextContent) return res.status(400).json({ error: 'Conteúdo obrigatório' });

  const nextImages = images !== undefined ? images : parseJson(post.images as string, [] as string[]);
  await db.prepare(
    `UPDATE posts SET content = ?, images = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(nextContent, JSON.stringify(nextImages), req.params.id);

  const updated = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  const liked = !!(await db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.user!.id));
  const premium = (await authorPremiumMap(db, [req.user!.id])).get(req.user!.id) ?? false;
  res.json(await formatPost(updated as Record<string, unknown>, liked, premium));
});

router.get('/:id/likes', authMiddleware, async (req, res) => {
  const db = await getDb();
  const post = await db.prepare('SELECT id FROM posts WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const likes = await db.prepare(
    'SELECT id, user_id, user_snapshot, created_at FROM likes WHERE post_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);

  res.json(
    likes.map((like) => {
      const snap = parseJson((like as { user_snapshot: string }).user_snapshot, {}) as {
        id?: string;
        username?: string;
        full_name?: string;
        avatar_url?: string | null;
      };
      return {
        id: like.id,
        user_id: like.user_id,
        created_at: like.created_at,
        user: {
          id: snap.id || like.user_id,
          username: snap.username || '',
          full_name: snap.full_name || 'Usuário',
          avatar_url: snap.avatar_url || null,
        },
      };
    })
  );
});

router.post('/:id/like', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(req.params.id)) as
    | { id: string; author_id: string; likes_count: number }
    | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const existing = await db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, req.user!.id);
  if (existing) return res.status(409).json({ error: 'Já curtido' });

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) as UserRow;
  await db.prepare('INSERT INTO likes (id, post_id, user_id, user_snapshot) VALUES (?, ?, ?, ?)').run(
    uuid(), post.id, user.id, userSnapshot(user)
  );
  await db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(post.id);
  await createNotification(post.author_id, user.id, 'like', 'post', post.id);
  res.json({ ok: true, likes_count: post.likes_count + 1 });
});

router.delete('/:id/like', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)) as { likes_count: number } | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const result = await db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  if (result.changes > 0) {
    await db.prepare('UPDATE posts SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END WHERE id = ?').run(req.params.id);
  }
  const updated = (await db.prepare('SELECT likes_count FROM posts WHERE id = ?').get(req.params.id)) as { likes_count: number };
  res.json({ ok: true, likes_count: updated.likes_count });
});

router.get('/:id/comments', authMiddleware, async (req, res) => {
  const db = await getDb();
  const comments = await db.prepare(
    'SELECT * FROM comments WHERE post_id = ? AND is_active = 1 ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(
    comments.map((c) => ({
      ...c,
      parent_id: (c as { parent_id?: string | null }).parent_id || null,
      author_snapshot: parseJson((c as { author_snapshot: string }).author_snapshot, {}),
    }))
  );
});

router.post('/:id/comments', authMiddleware, async (req: AuthRequest, res) => {
  const { content, parent_id } = req.body as { content?: string; parent_id?: string | null };
  if (!content?.trim()) return res.status(400).json({ error: 'Comentário vazio' });

  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(req.params.id)) as
    | { id: string; author_id: string }
    | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  let parentAuthorId: string | null = null;
  if (parent_id) {
    const parent = (await db.prepare(
      'SELECT id, author_id, post_id, is_active FROM comments WHERE id = ?'
    ).get(parent_id)) as { id: string; author_id: string; post_id: string; is_active: number } | undefined;
    if (!parent || parent.post_id !== post.id || !parent.is_active) {
      return res.status(400).json({ error: 'Comentário pai inválido' });
    }
    parentAuthorId = parent.author_id;
  }

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) as UserRow;
  const id = uuid();
  await db.prepare(
    'INSERT INTO comments (id, post_id, author_id, content, author_snapshot, parent_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, post.id, user.id, content.trim(), userSnapshot(user), parent_id || null);
  await db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(post.id);
  await createNotification(post.author_id, user.id, 'comment', 'post', post.id);
  if (parentAuthorId) {
    await createNotification(parentAuthorId, user.id, 'comment_reply', 'comment', id);
  }

  const comment = await db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  res.status(201).json({
    ...comment,
    parent_id: (comment as { parent_id?: string | null }).parent_id || null,
    author_snapshot: parseJson((comment as { author_snapshot: string }).author_snapshot, {}),
  });
});

router.delete('/:id/comments/:commentId', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = (await db.prepare('SELECT id, author_id FROM posts WHERE id = ?').get(req.params.id)) as
    | { id: string; author_id: string }
    | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const comment = (await db.prepare(
    'SELECT id, author_id, post_id, is_active FROM comments WHERE id = ?'
  ).get(req.params.commentId)) as
    | { id: string; author_id: string; post_id: string; is_active: number }
    | undefined;
  if (!comment || comment.post_id !== post.id) return res.status(404).json({ error: 'Comentário não encontrado' });
  if (!comment.is_active) return res.json({ ok: true });

  const canDelete = comment.author_id === req.user!.id || post.author_id === req.user!.id;
  if (!canDelete) return res.status(403).json({ error: 'Sem permissão' });

  await db.prepare('UPDATE comments SET is_active = 0 WHERE id = ?').run(comment.id);
  // Também oculta respostas diretas do comentário excluído
  await db.prepare('UPDATE comments SET is_active = 0 WHERE parent_id = ? AND is_active = 1').run(comment.id);

  const activeCount = (await db.prepare(
    'SELECT COUNT(*)::int as c FROM comments WHERE post_id = ? AND is_active = 1'
  ).get(post.id)) as { c: number };
  await db.prepare('UPDATE posts SET comments_count = ? WHERE id = ?').run(activeCount.c, post.id);

  res.json({ ok: true, comments_count: activeCount.c });
});

router.post('/:id/share', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const id = uuid();
  await db.prepare('INSERT INTO shares (id, post_id, user_id, post_snapshot) VALUES (?, ?, ?, ?)').run(
    id, req.params.id, req.user!.id, JSON.stringify(post)
  );
  const postId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await createNotification((post as { author_id: string }).author_id, req.user!.id, 'share', 'post', postId);
  res.status(201).json({ ok: true });
});

export default router;
