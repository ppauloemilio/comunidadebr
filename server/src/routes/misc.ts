import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson } from '../db/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { uploadsDir } from '../lib/uploads.js';
import { getMonetizationSettings, isPremiumProfile } from '../lib/settings.js';
import { getActiveAdvertisements } from '../lib/advertisements.js';

const isServerless = () => !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

// Sempre em memória — no serverless o disco é read-only fora de /tmp
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.get('/settings/public', async (_req, res) => {
  res.json(await getMonetizationSettings());
});

router.get('/countries', async (_req, res) => {
  const db = await getDb();
  const countries = await db.prepare('SELECT * FROM countries WHERE is_active = 1 ORDER BY name').all();
  res.json(countries);
});

router.get('/skills', async (_req, res) => {
  const db = await getDb();
  const skills = await db.prepare('SELECT * FROM skills ORDER BY name').all();
  res.json(skills);
});

router.get('/advertisements', async (req, res) => {
  const settings = await getMonetizationSettings();
  if (!settings.ads_enabled) return res.json([]);

  const placement = req.query.placement as string | undefined;
  if (placement === 'feed' || placement === 'sidebar') {
    return res.json(await getActiveAdvertisements(placement));
  }

  return res.json([
    ...(await getActiveAdvertisements('feed')),
    ...(await getActiveAdvertisements('sidebar')),
  ]);
});

router.get('/explore', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const type = (req.query.type as string) || 'people';
  const q = (req.query.q as string)?.trim();
  const country = (req.query.country as string)?.trim();
  const state = (req.query.state as string)?.trim();
  const city = (req.query.city as string)?.trim();
  const area = (req.query.area as string)?.trim();

  if (type === 'businesses') {
    const conditions = ['b.is_active = 1', "UPPER(TRIM(b.country)) != 'BR'"];
    const params: string[] = [];

    if (country) {
      conditions.push('b.country = ?');
      params.push(country);
    }
    if (area) {
      conditions.push('(b.category LIKE ? OR b.skills LIKE ?)');
      params.push(`%${area}%`, `%${area}%`);
    }
    if (city) {
      conditions.push('(b.city = ? OR (TRIM(COALESCE(b.city, "")) = "" AND b.address LIKE ?))');
      params.push(city, `%${city}%`);
    }
    if (state) {
      conditions.push('(b.state = ? OR (TRIM(COALESCE(b.state, "")) = "" AND b.address LIKE ?))');
      params.push(state, `%${state}%`);
    }
    if (q) {
      conditions.push('(b.name LIKE ? OR b.category LIKE ? OR b.address LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const businesses = await db.prepare(
      `SELECT b.*, u.full_name as owner_name, u.username as owner_username
       FROM businesses b
       JOIN users u ON u.id = b.owner_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY b.created_at DESC
       LIMIT 50`
    ).all(...params);

    return res.json({
      users: [],
      businesses: businesses.map((b) => ({
        ...b,
        skills: parseJson((b as { skills: string }).skills, []),
        photos: parseJson((b as { photos: string }).photos, []),
      })),
    });
  }

  const conditions = ["UPPER(TRIM(p.current_country)) != 'BR'"];
  const params: string[] = [];

  if (country) {
    conditions.push('p.current_country = ?');
    params.push(country);
  }
  if (state) {
    conditions.push('p.current_state = ?');
    params.push(state);
  }
  if (city) {
    conditions.push('p.current_city = ?');
    params.push(city);
  }
  if (area) {
    conditions.push('p.primary_skill = ?');
    params.push(area);
  }
  if (q) {
    conditions.push(
      `(u.full_name LIKE ? OR u.username LIKE ? OR p.bio LIKE ? OR p.primary_skill LIKE ?
        OR EXISTS (SELECT 1 FROM user_skills us WHERE us.user_id = u.id AND us.skill_name LIKE ?))`
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const users = await db.prepare(
    `SELECT u.id, u.username, u.full_name, u.avatar_url,
            p.bio, p.current_country, p.current_city, p.current_state,
            p.primary_skill, p.show_city_on_profile, p.is_premium, p.premium_until
     FROM users u
     JOIN public_profiles p ON p.user_id = u.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE WHEN p.is_premium = 1 AND (p.premium_until IS NULL OR p.premium_until >= datetime('now')) THEN 0 ELSE 1 END,
       u.full_name ASC
     LIMIT 50`
  ).all(...params);

  const mappedUsers = await Promise.all(
    (users as Array<Record<string, unknown>>).map(async (u) => ({
      ...u,
      is_premium: await isPremiumProfile(u as { is_premium?: number; premium_until?: string | null }),
    }))
  );

  res.json({ users: mappedUsers, businesses: [] });
});

router.get('/search', authMiddleware, async (req: AuthRequest, res) => {
  const q = (req.query.q as string)?.trim();
  if (!q) return res.json({ businesses: [], users: [], posts: [] });

  const db = await getDb();
  const businesses = await db.prepare(
    `SELECT id, name, category, address FROM businesses WHERE is_active = 1
     AND (name LIKE ? OR category LIKE ? OR address LIKE ?) LIMIT 10`
  ).all(`%${q}%`, `%${q}%`, `%${q}%`);

  const users = await db.prepare(
    `SELECT u.id, u.full_name, u.username FROM users u
     WHERE u.full_name LIKE ? OR u.username LIKE ? LIMIT 10`
  ).all(`%${q}%`, `%${q}%`);

  const posts = await db.prepare(
    `SELECT id, content FROM posts WHERE is_active = 1 AND content LIKE ? LIMIT 10`
  ).all(`%${q}%`);

  res.json({ businesses, users, posts });
});

router.get('/feed/sidebar', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const profile = (await db.prepare('SELECT current_country FROM public_profiles WHERE user_id = ?').get(req.user!.id)) as
    | { current_country: string }
    | undefined;
  const country = profile?.current_country || 'BR';

  const trending = await db.prepare(
    `SELECT id, content, likes_count FROM posts WHERE is_active = 1 AND country = ?
     ORDER BY likes_count DESC LIMIT 5`
  ).all(country);

  const users = await db.prepare(
    `SELECT u.id, u.username, u.full_name, u.avatar_url, p.current_country,
            b.address as address
     FROM users u
     JOIN public_profiles p ON p.user_id = u.id
     LEFT JOIN businesses b ON b.owner_id = u.id AND b.is_active = 1
     WHERE p.current_country = ? AND u.id != ?
     GROUP BY u.id
     LIMIT 10`
  ).all(country, req.user!.id);

  res.json({ trending, users, country });
});

router.post('/upload', authMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Falha no upload';
      return res.status(400).json({ error: message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'Arquivo obrigatório' });
    }

    const mime = req.file.mimetype || 'image/jpeg';
    const ext =
      path.extname(req.file.originalname) ||
      (mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg');
    const filename = `${uuid()}${ext}`;
    const buffer = req.file.buffer;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = await import('@vercel/blob');
        const blob = await put(`uploads/${filename}`, buffer, {
          access: 'public',
          contentType: mime,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        return res.json({ url: blob.url });
      } catch (err) {
        console.error('Blob upload failed:', err);
      }
    }

    // Serverless sem Blob: data URL pequena (posts/anúncios). Perfil usa PATCH direto no client.
    if (isServerless()) {
      if (buffer.length > 900_000) {
        return res.status(413).json({
          error: 'Imagem muito grande. Comprima antes de enviar.',
        });
      }
      return res.json({ url: `data:${mime};base64,${buffer.toString('base64')}` });
    }

    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    return res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Falha no upload',
    });
  }
});

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0' });
});

export default router;
