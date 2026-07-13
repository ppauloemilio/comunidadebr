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

type FormattedPost = {
  id: unknown;
  content: unknown;
  type: unknown;
  images: unknown;
  author_id: unknown;
  business_id: unknown;
  country: unknown;
  likes_count: unknown;
  comments_count: unknown;
  is_active: unknown;
  is_promoted: boolean;
  author_is_premium: boolean;
  author_snapshot: Record<string, unknown>;
  created_at: unknown;
  updated_at: unknown;
  liked_by_me: boolean;
  shared_post_id: string | null;
  shared_post: FormattedPost | null;
  visibility: string;
};

async function formatPost(
  row: Record<string, unknown>,
  likedByMe = false,
  authorIsPremium = false,
  sharedPost: FormattedPost | null = null
): Promise<FormattedPost> {
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
    shared_post_id: (row.shared_post_id as string) || null,
    shared_post: sharedPost,
    visibility: (row.visibility as string) || 'public',
  };
}

async function friendIdsOf(db: Db, userId: string) {
  const rows = (await db.prepare(
    `SELECT CASE WHEN requester_id = ? THEN receiver_id ELSE requester_id END AS friend_id
     FROM friendships
     WHERE status = 'accepted' AND (requester_id = ? OR receiver_id = ?)`
  ).all(userId, userId, userId)) as { friend_id: string }[];
  return rows.map((r) => r.friend_id);
}

async function blockedAuthorIds(db: Db, userId: string) {
  const rows = (await db.prepare(
    `SELECT CASE WHEN blocker_id = ? THEN blocked_id ELSE blocker_id END AS other_id
     FROM blocks
     WHERE blocker_id = ? OR blocked_id = ?`
  ).all(userId, userId, userId)) as { other_id: string }[];
  return new Set(rows.map((r) => r.other_id));
}

/** Público, próprio, ou amigos; exclui autores bloqueados. */
function canViewerSeePost(
  post: { author_id: unknown; visibility?: unknown },
  viewerId: string,
  friendSet: Set<string>,
  blockedSet: Set<string>
) {
  const authorId = String(post.author_id);
  if (blockedSet.has(authorId)) return false;
  if (authorId === viewerId) return true;
  const visibility = String(post.visibility || 'public');
  if (visibility === 'friends') return friendSet.has(authorId);
  return true;
}

/** Resolve o post original (evita compartilhar um compartilhamento). */
async function resolveShareTarget(db: Db, post: Record<string, unknown>) {
  const nestedId = post.shared_post_id as string | null | undefined;
  if (!nestedId) return post;
  const original = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(nestedId)) as
    | Record<string, unknown>
    | undefined;
  return original || post;
}

async function attachSharedPosts(
  db: Db,
  posts: FormattedPost[],
  likedSet: Set<string>
) {
  const ids = [...new Set(posts.map((p) => p.shared_post_id).filter(Boolean))] as string[];
  if (!ids.length) return posts;

  const placeholders = ids.map(() => '?').join(',');
  const rows = (await db.prepare(
    `SELECT * FROM posts WHERE id IN (${placeholders}) AND is_active = 1`
  ).all(...ids)) as Record<string, unknown>[];
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const premiumByAuthor = await authorPremiumMap(
    db,
    rows.map((r) => r.author_id as string)
  );

  return Promise.all(
    posts.map(async (p) => {
      if (!p.shared_post_id) return p;
      const row = byId.get(p.shared_post_id);
      if (!row) return { ...p, shared_post: null };
      const nested = await formatPost(
        row,
        likedSet.has(row.id as string),
        premiumByAuthor.get(row.author_id as string) ?? false,
        null
      );
      return { ...p, shared_post: nested };
    })
  );
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

  const friends = await friendIdsOf(db, req.user!.id);
  const friendSet = new Set(friends);
  const blockedSet = await blockedAuthorIds(db, req.user!.id);
  posts = (posts as Record<string, unknown>[]).filter((p) =>
    canViewerSeePost(p, req.user!.id, friendSet, blockedSet)
  );

  const likes = (await db.prepare('SELECT post_id FROM likes WHERE user_id = ?').all(req.user!.id)) as { post_id: string }[];
  const likedSet = new Set(likes.map((l) => l.post_id));

  const premiumByAuthor = await authorPremiumMap(
    db,
    posts.map((p) => p.author_id as string)
  );

  const formatted = await Promise.all(
    posts.map((p) => formatPost(
      p as Record<string, unknown>,
      likedSet.has(p.id as string),
      premiumByAuthor.get(p.author_id as string) ?? false
    ))
  );

  res.json(await attachSharedPosts(db, formatted, likedSet));
});

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
  const { content, type = 'text', images = [], business_id, shared_post_id, visibility = 'public' } = req.body;
  const audience = visibility === 'friends' ? 'friends' : 'public';
  const hasShare = !!shared_post_id;
  if (!hasShare && !content?.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });

  const db = await getDb();
  let shareTargetId: string | null = null;
  if (hasShare) {
    const target = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(shared_post_id)) as
      | Record<string, unknown>
      | undefined;
    if (!target) return res.status(404).json({ error: 'Publicação original não encontrada' });
    const resolved = await resolveShareTarget(db, target);
    shareTargetId = resolved.id as string;
  }

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) as UserRow;
  const profile = (await db.prepare('SELECT current_country, current_city FROM public_profiles WHERE user_id = ?').get(user.id)) as
    | { current_country: string; current_city: string }
    | undefined;

  const id = uuid();
  await db.prepare(
    `INSERT INTO posts (id, content, type, images, author_id, business_id, country, author_snapshot, shared_post_id, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (content || '').trim(),
    shareTargetId ? 'share' : type,
    JSON.stringify(images),
    user.id,
    business_id || null,
    profile?.current_country || 'BR',
    userSnapshot({
      ...user,
      city: profile?.current_city,
      country: profile?.current_country,
    }),
    shareTargetId,
    audience
  );

  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  const premium = (await authorPremiumMap(db, [user.id])).get(user.id) ?? false;
  const formatted = await formatPost(post as Record<string, unknown>, false, premium);
  const [withShared] = await attachSharedPosts(db, [formatted], new Set());
  res.status(201).json(withShared);
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id)) as { author_id: string } | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  if (post.author_id !== req.user!.id) return res.status(403).json({ error: 'Sem permissão' });
  await db.prepare('UPDATE posts SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(req.params.id)) as
    | Record<string, unknown>
    | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const friends = await friendIdsOf(db, req.user!.id);
  const friendSet = new Set(friends);
  const blockedSet = await blockedAuthorIds(db, req.user!.id);
  if (!canViewerSeePost(post, req.user!.id, friendSet, blockedSet)) {
    return res.status(403).json({ error: 'Post disponível apenas para amigos' });
  }

  const liked = !!(await db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.user!.id));
  const premiumByAuthor = await authorPremiumMap(db, [post.author_id as string]);
  const formatted = await formatPost(
    post,
    liked,
    premiumByAuthor.get(post.author_id as string) ?? false
  );
  const likedSet = new Set<string>(liked ? [req.params.id as string] : []);
  if (formatted.shared_post_id) {
    const sharedLiked = !!(await db.prepare(
      'SELECT id FROM likes WHERE post_id = ? AND user_id = ?'
    ).get(formatted.shared_post_id, req.user!.id));
    if (sharedLiked) likedSet.add(formatted.shared_post_id);
  }
  const [withShared] = await attachSharedPosts(db, [formatted], likedSet);
  res.json(withShared);
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
  if (!nextContent && !post.shared_post_id) return res.status(400).json({ error: 'Conteúdo obrigatório' });

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
  const { comment = '' } = (req.body || {}) as { comment?: string };
  const db = await getDb();
  const post = (await db.prepare('SELECT * FROM posts WHERE id = ? AND is_active = 1').get(req.params.id)) as
    | Record<string, unknown>
    | undefined;
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  const target = await resolveShareTarget(db, post);
  const targetId = target.id as string;

  const shareId = uuid();
  await db.prepare('INSERT INTO shares (id, post_id, user_id, post_snapshot) VALUES (?, ?, ?, ?)').run(
    shareId, targetId, req.user!.id, JSON.stringify(target)
  );

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id)) as UserRow;
  const profile = (await db.prepare('SELECT current_country, current_city FROM public_profiles WHERE user_id = ?').get(user.id)) as
    | { current_country: string; current_city: string }
    | undefined;

  const newPostId = uuid();
  await db.prepare(
    `INSERT INTO posts (id, content, type, images, author_id, business_id, country, author_snapshot, shared_post_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newPostId,
    String(comment || '').trim(),
    'share',
    '[]',
    user.id,
    null,
    profile?.current_country || 'BR',
    userSnapshot({
      ...user,
      city: profile?.current_city,
      country: profile?.current_country,
    }),
    targetId
  );

  await createNotification(target.author_id as string, req.user!.id, 'share', 'post', targetId);

  const created = await db.prepare('SELECT * FROM posts WHERE id = ?').get(newPostId);
  const premium = (await authorPremiumMap(db, [user.id])).get(user.id) ?? false;
  const formatted = await formatPost(created as Record<string, unknown>, false, premium);
  const [withShared] = await attachSharedPosts(db, [formatted], new Set());
  res.status(201).json(withShared);
});

export default router;
