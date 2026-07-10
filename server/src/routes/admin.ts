import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';
import { getMonetizationSettings, setMonetizationSettings } from '../lib/settings.js';
import { ADMIN_EMAIL, createPasswordInvite } from '../lib/adminUser.js';
import { sendPasswordInviteEmail } from '../lib/email.js';
import { applyMonetizationExamples } from '../lib/seedMonetizationExamples.js';
import {
  enrichAdvertisement,
  expireStaleAdvertisements,
  resolveAdPayload,
  type AdvertisementRow,
} from '../lib/advertisements.js';

const router = Router();

function paramId(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

router.use(authMiddleware, adminMiddleware);

router.get('/stats', async (_req, res) => {
  const db = await getDb();
  const users = (await db.prepare('SELECT COUNT(*)::int as c FROM users').get()) as { c: number };
  const activeUsers = (await db.prepare('SELECT COUNT(*)::int as c FROM users WHERE COALESCE(is_active, 1) = 1').get()) as { c: number };
  const posts = (await db.prepare('SELECT COUNT(*)::int as c FROM posts WHERE is_active = 1').get()) as { c: number };
  const businesses = (await db.prepare('SELECT COUNT(*)::int as c FROM businesses WHERE is_active = 1').get()) as { c: number };
  const admins = (await db.prepare('SELECT COUNT(*)::int as c FROM users WHERE is_admin = 1').get()) as { c: number };
  const ads = (await db.prepare('SELECT COUNT(*)::int as c FROM advertisements WHERE is_active = 1').get()) as { c: number };
  res.json({
    users: users.c,
    active_users: activeUsers.c,
    posts: posts.c,
    businesses: businesses.c,
    admins: admins.c,
    ads: ads.c,
  });
});

router.get('/settings', async (_req, res) => {
  res.json(await getMonetizationSettings());
});

router.patch('/settings', async (req, res) => {
  const { ads_enabled, featured_business_enabled, paid_posts_enabled, premium_profile_enabled, banner_rotation_seconds } = req.body;
  const next = await setMonetizationSettings({
    ...(ads_enabled !== undefined && { ads_enabled: !!ads_enabled }),
    ...(featured_business_enabled !== undefined && { featured_business_enabled: !!featured_business_enabled }),
    ...(paid_posts_enabled !== undefined && { paid_posts_enabled: !!paid_posts_enabled }),
    ...(premium_profile_enabled !== undefined && { premium_profile_enabled: !!premium_profile_enabled }),
    ...(banner_rotation_seconds !== undefined && {
      banner_rotation_seconds: Math.max(5, Math.min(120, Number(banner_rotation_seconds) || 30)),
    }),
  });
  res.json(next);
});

router.post('/monetization-examples', async (_req, res) => {
  await applyMonetizationExamples(await getDb());
  res.json({ ok: true });
});

// --- Advertisements ---
router.get('/advertisements', async (_req, res) => {
  const db = await getDb();
  await expireStaleAdvertisements(db);
  const rows = (await db.prepare(
    'SELECT * FROM advertisements ORDER BY placement ASC, order_num ASC, title ASC'
  ).all()) as AdvertisementRow[];
  res.json(await Promise.all(rows.map((row) => enrichAdvertisement(db, row))));
});

router.get('/advertisements/slots', async (_req, res) => {
  const db = await getDb();
  await expireStaleAdvertisements(db);
  const rows = (await db.prepare(
    'SELECT * FROM advertisements ORDER BY placement ASC, order_num ASC, title ASC'
  ).all()) as AdvertisementRow[];
  const enriched = await Promise.all(rows.map((row) => enrichAdvertisement(db, row)));
  res.json({
    feed: enriched.filter((a) => a.placement === 'feed'),
    sidebar: enriched.filter((a) => a.placement === 'sidebar'),
  });
});

router.post('/advertisements', async (req, res) => {
  const db = await getDb();
  await expireStaleAdvertisements(db);
  const { is_active, order_num, start_date, end_date } = req.body;
  const active = is_active !== false;
  const resolved = await resolveAdPayload(
    db,
    { ...req.body, start_date, end_date },
    { activating: active }
  );
  if ('error' in resolved) return res.status(400).json({ error: resolved.error });

  const id = uuid();
  await db.prepare(
    `INSERT INTO advertisements (
      id, title, image_url, link_url, description, is_active, order_num,
      start_date, end_date, placement, source_type, user_id, business_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`
  ).run(
    id,
    resolved.title,
    resolved.image_url,
    resolved.link_url,
    resolved.description,
    active ? 1 : 0,
    order_num ?? 0,
    resolved.start_date,
    resolved.end_date,
    resolved.placement,
    resolved.user_id,
    resolved.business_id
  );

  const row = (await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id)) as AdvertisementRow;
  res.status(201).json(await enrichAdvertisement(db, row));
});

router.patch('/advertisements/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const db = await getDb();
  await expireStaleAdvertisements(db);
  const existing = (await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id)) as AdvertisementRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Anúncio não encontrado' });

  const { is_active, order_num, start_date, end_date } = req.body;
  const active = is_active !== undefined ? !!is_active : !!existing.is_active;

  const merged = {
    title: req.body.title ?? existing.title,
    image_url: req.body.image_url ?? existing.image_url,
    link_url: req.body.link_url ?? existing.link_url,
    description: req.body.description ?? existing.description,
    placement: req.body.placement ?? existing.placement,
    user_id: req.body.user_id ?? existing.user_id,
    business_id: req.body.business_id ?? existing.business_id,
    start_date: start_date !== undefined ? start_date : existing.start_date,
    end_date: end_date !== undefined ? end_date : existing.end_date,
  };

  const resolved = await resolveAdPayload(db, merged, { exceptId: id, activating: active });
  if ('error' in resolved) return res.status(400).json({ error: resolved.error });

  await db.prepare(
    `UPDATE advertisements SET
     title = ?, image_url = ?, link_url = ?, description = ?,
     placement = ?, user_id = ?, business_id = ?, source_type = 'user',
     is_active = ?, order_num = COALESCE(?, order_num),
     start_date = ?, end_date = ?
     WHERE id = ?`
  ).run(
    resolved.title,
    resolved.image_url,
    resolved.link_url,
    resolved.description,
    resolved.placement,
    resolved.user_id,
    resolved.business_id,
    active ? 1 : 0,
    order_num ?? null,
    resolved.start_date,
    resolved.end_date,
    id
  );

  const row = (await db.prepare('SELECT * FROM advertisements WHERE id = ?').get(id)) as AdvertisementRow;
  res.json(await enrichAdvertisement(db, row));
});

router.delete('/advertisements/:id', async (req, res) => {
  const db = await getDb();
  await db.prepare('DELETE FROM advertisements WHERE id = ?').run(paramId(req.params.id));
  res.json({ ok: true });
});

// --- Businesses management ---
router.get('/businesses', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const status = (req.query.status as string)?.trim();
  const db = await getDb();
  const conditions: string[] = ['1=1'];
  const params: string[] = [];
  if (q) {
    conditions.push('(b.name LIKE ? OR b.category LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === 'active') conditions.push('b.is_active = 1');
  if (status === 'inactive') conditions.push('b.is_active = 0');
  const ownerId = (req.query.owner_id as string)?.trim();
  if (ownerId) {
    conditions.push('b.owner_id = ?');
    params.push(ownerId);
  }

  const businesses = await db.prepare(
    `SELECT b.*, u.full_name AS owner_name, u.email AS owner_email FROM businesses b
     JOIN users u ON u.id = b.owner_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY b.is_featured DESC, b.created_at DESC LIMIT 100`
  ).all(...params);
  res.json(businesses);
});

router.patch('/businesses/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const { is_active, is_featured, featured_until, featured_order } = req.body;
  const db = await getDb();
  const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').get(id);
  if (!biz) return res.status(404).json({ error: 'Negócio não encontrado' });

  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (col: string, val: unknown) => { fields.push(`${col} = ?`); params.push(val as string | number | null); };
  if (is_active !== undefined) set('is_active', is_active ? 1 : 0);
  if (is_featured !== undefined) set('is_featured', is_featured ? 1 : 0);
  if (featured_until !== undefined) set('featured_until', featured_until);
  if (featured_order !== undefined) set('featured_order', featured_order);
  if (fields.length) {
    await db.prepare(`UPDATE businesses SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }
  res.json({ ok: true });
});

router.patch('/businesses/:id/featured', async (req, res) => {
  const id = paramId(req.params.id);
  const { is_featured, featured_until, featured_order } = req.body;
  const db = await getDb();
  const biz = await db.prepare('SELECT id FROM businesses WHERE id = ?').get(id);
  if (!biz) return res.status(404).json({ error: 'Negócio não encontrado' });

  await db.prepare(
    `UPDATE businesses SET is_featured = ?, featured_until = ?, featured_order = ? WHERE id = ?`
  ).run(
    is_featured ? 1 : 0,
    featured_until || null,
    featured_order ?? 0,
    id
  );
  res.json({ ok: true });
});

// --- Posts management ---
router.get('/posts', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const type = (req.query.type as string)?.trim();
  const status = (req.query.status as string)?.trim();
  const db = await getDb();
  const conditions: string[] = ['1=1'];
  const params: string[] = [];
  if (q) {
    conditions.push('(p.content LIKE ? OR u.full_name LIKE ? OR u.username LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (type) {
    conditions.push('p.type = ?');
    params.push(type);
  }
  if (status === 'active') conditions.push('p.is_active = 1');
  if (status === 'inactive') conditions.push('p.is_active = 0');

  const posts = await db.prepare(
    `SELECT p.id, p.content, p.type, p.country, p.likes_count, p.comments_count,
            p.is_active, p.is_promoted, p.promoted_until, p.created_at,
            u.full_name, u.username, u.id AS author_id
     FROM posts p JOIN users u ON u.id = p.author_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.created_at DESC LIMIT 100`
  ).all(...params);
  res.json(posts);
});

router.patch('/posts/:id', async (req, res) => {
  const id = paramId(req.params.id);
  const { is_active, is_promoted, promoted_until } = req.body;
  const db = await getDb();
  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });
  const fields: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (col: string, val: unknown) => { fields.push(`${col} = ?`); params.push(val as string | number | null); };
  if (is_active !== undefined) set('is_active', is_active ? 1 : 0);
  if (is_promoted !== undefined) set('is_promoted', is_promoted ? 1 : 0);
  if (promoted_until !== undefined) set('promoted_until', promoted_until);
  if (fields.length) {
    await db.prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }
  res.json({ ok: true });
});

router.get('/posts/promotions', async (_req, res) => {
  const db = await getDb();
  const posts = await db.prepare(
    `SELECT p.*, u.full_name, u.username FROM posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.type IN ('job', 'event') AND p.is_active = 1
     ORDER BY p.is_promoted DESC, p.created_at DESC LIMIT 50`
  ).all();
  res.json(posts);
});

router.patch('/posts/:id/promotion', async (req, res) => {
  const id = paramId(req.params.id);
  const { is_promoted, promoted_until } = req.body;
  const db = await getDb();
  const post = await db.prepare('SELECT id FROM posts WHERE id = ?').get(id);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  await db.prepare('UPDATE posts SET is_promoted = ?, promoted_until = ? WHERE id = ?').run(
    is_promoted ? 1 : 0,
    promoted_until || null,
    id
  );
  res.json({ ok: true });
});

// --- Users management ---
router.get('/users', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const status = (req.query.status as string)?.trim();
  const db = await getDb();
  const conditions: string[] = ['1=1'];
  const params: string[] = [];
  if (q) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status === 'active') conditions.push('COALESCE(u.is_active, 1) = 1');
  if (status === 'inactive') conditions.push('COALESCE(u.is_active, 1) = 0');
  if (status === 'admin') conditions.push('u.is_admin = 1');

  const users = await db.prepare(
    `SELECT u.id, u.email, u.username, u.full_name, u.is_admin, u.is_active, u.created_at,
            p.is_premium, p.premium_until, p.current_country,
            (SELECT COUNT(*) FROM posts WHERE author_id = u.id AND is_active = 1) AS posts_count,
            (SELECT COUNT(*) FROM businesses WHERE owner_id = u.id AND is_active = 1) AS businesses_count
     FROM users u LEFT JOIN public_profiles p ON p.user_id = u.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY u.created_at DESC LIMIT 100`
  ).all(...params);
  res.json(users);
});

router.patch('/users/:id', async (req: AuthRequest, res) => {
  const id = paramId(req.params.id);
  const { is_admin, is_premium, premium_until, is_active } = req.body;
  const db = await getDb();
  const user = (await db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(id)) as
    | { id: string; is_admin: number }
    | undefined;
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  if (is_admin !== undefined) {
    if (id === req.user!.id && !is_admin) {
      return res.status(400).json({ error: 'Você não pode remover seu próprio acesso de admin' });
    }
    await db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, id);
  }
  if (is_active !== undefined) {
    if (id === req.user!.id && !is_active) {
      return res.status(400).json({ error: 'Você não pode desativar sua própria conta' });
    }
    await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
  }
  if (is_premium !== undefined || premium_until !== undefined) {
    const profile = await db.prepare('SELECT user_id FROM public_profiles WHERE user_id = ?').get(id);
    if (!profile) {
      await db.prepare('INSERT INTO public_profiles (user_id, current_country) VALUES (?, ?)').run(id, 'BR');
    }
    if (is_premium !== undefined) {
      await db.prepare('UPDATE public_profiles SET is_premium = ? WHERE user_id = ?').run(is_premium ? 1 : 0, id);
    }
    if (premium_until !== undefined) {
      await db.prepare('UPDATE public_profiles SET premium_until = ? WHERE user_id = ?').run(premium_until, id);
    }
  }
  res.json({ ok: true });
});

router.patch('/users/:id/premium', async (req, res) => {
  const id = paramId(req.params.id);
  const { is_premium, premium_until } = req.body;
  const db = await getDb();
  const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const profile = await db.prepare('SELECT user_id FROM public_profiles WHERE user_id = ?').get(id);
  if (!profile) {
    await db.prepare('INSERT INTO public_profiles (user_id, current_country) VALUES (?, ?)').run(id, 'BR');
  }

  await db.prepare('UPDATE public_profiles SET is_premium = ?, premium_until = ? WHERE user_id = ?').run(
    is_premium ? 1 : 0,
    premium_until || null,
    id
  );
  res.json({ ok: true });
});

// --- Resend admin invite ---
router.post('/resend-invite', async (req, res) => {
  const email = (req.body.email as string) || ADMIN_EMAIL;
  const db = await getDb();
  const user = (await db.prepare('SELECT id, full_name FROM users WHERE email = ?').get(email)) as
    | { id: string; full_name: string }
    | undefined;
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const token = await createPasswordInvite(db, user.id, email);
  const result = await sendPasswordInviteEmail(email, token, user.full_name);
  res.json({ ok: true, sent: result.sent, setupUrl: result.sent ? undefined : result.setupUrl });
});

export default router;
