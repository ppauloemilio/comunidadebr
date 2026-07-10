import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson, publicUser, userSnapshot, UserRow } from '../db/database.js';
import { authMiddleware, AuthRequest, signToken } from '../middleware/auth.js';
import { isPremiumProfile } from '../lib/settings.js';

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password, username, full_name, country = 'BR' } = req.body;
  if (!email || !password || !username || !full_name) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
  }
  const db = await getDb();
  const existing = await db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
  if (existing) return res.status(409).json({ error: 'Email ou username já em uso' });

  const id = uuid();
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('INSERT INTO users (id, email, password_hash, username, full_name) VALUES (?, ?, ?, ?, ?)').run(
    id, email, hash, username, full_name
  );
  await db.prepare('INSERT INTO public_profiles (user_id, current_country) VALUES (?, ?)').run(id, country);
  await db.prepare('INSERT INTO user_country_history (id, user_id, country, joined_at) VALUES (?, ?, ?, ?)').run(
    uuid(), id, country, new Date().toISOString()
  );

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  const token = signToken(id);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

  const db = await getDb();
  const found = await db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (!found) return res.status(401).json({ error: 'Credenciais inválidas' });
  if (found.is_active === 0) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o suporte.' });
  if (found.password_set === 0) {
    return res.status(403).json({ error: 'Defina sua senha pelo link enviado ao seu e-mail antes de entrar.' });
  }
  if (!bcrypt.compareSync(password, found.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }
  res.json({ token: signToken(found.id), user: publicUser(found) });
});

router.get('/invite/:token', async (req, res) => {
  const db = await getDb();
  const invite = await db.prepare(
    `SELECT pi.*, u.full_name, u.email FROM password_invites pi
     JOIN users u ON u.id = pi.user_id
     WHERE pi.token = ? AND pi.used_at IS NULL`
  ).get(req.params.token) as { email: string; full_name: string; expires_at: string } | undefined;
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou já utilizado' });
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Convite expirado. Solicite um novo ao administrador.' });
  }
  res.json({ email: invite.email, full_name: invite.full_name });
});

router.post('/setup-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Token e senha (mín. 6 caracteres) são obrigatórios' });
  }
  const db = await getDb();
  const invite = await db.prepare(
    'SELECT * FROM password_invites WHERE token = ? AND used_at IS NULL'
  ).get(token) as { id: string; user_id: string; expires_at: string } | undefined;
  if (!invite) return res.status(404).json({ error: 'Convite inválido ou já utilizado' });
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Convite expirado' });
  }

  const hash = bcrypt.hashSync(password, 10);
  await db.prepare('UPDATE users SET password_hash = ?, password_set = 1 WHERE id = ?').run(hash, invite.user_id);
  await db.prepare(`UPDATE password_invites SET used_at = datetime('now') WHERE id = ?`).run(invite.id);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(invite.user_id) as UserRow;
  res.json({ token: signToken(user.id), user: publicUser(user) });
});

router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
  const profile = await db.prepare('SELECT * FROM public_profiles WHERE user_id = ?').get(user.id) as {
    bio: string; current_country: string; current_city: string; current_state: string;
    origin_city: string; origin_state: string; cover_url: string; primary_skill: string;
    show_city_on_profile: number; show_whatsapp_on_profile: number;
    social_links: string; languages: string;
    is_premium?: number; premium_until?: string | null;
  };
  const skills = await db.prepare('SELECT * FROM user_skills WHERE user_id = ?').all(user.id);
  const history = await db.prepare('SELECT * FROM user_country_history WHERE user_id = ?').all(user.id);
  const followers = (await db.prepare('SELECT COUNT(*)::int as c FROM follows WHERE following_id = ?').get(user.id)) as { c: number };
  const following = (await db.prepare('SELECT COUNT(*)::int as c FROM follows WHERE follower_id = ?').get(user.id)) as { c: number };
  const posts = (await db.prepare('SELECT COUNT(*)::int as c FROM posts WHERE author_id = ? AND is_active = 1').get(user.id)) as { c: number };
  res.json({
    ...publicUser(user),
    is_premium: await isPremiumProfile(profile),
    profile: {
      bio: profile?.bio || '',
      current_country: profile?.current_country || 'BR',
      current_city: profile?.current_city || '',
      current_state: profile?.current_state || '',
      origin_city: profile?.origin_city || '',
      origin_state: profile?.origin_state || '',
      cover_url: profile?.cover_url || '',
      primary_skill: profile?.primary_skill || '',
      show_city_on_profile: !!(profile?.show_city_on_profile ?? 1),
      show_whatsapp_on_profile: !!profile?.show_whatsapp_on_profile,
      social_links: parseJson(profile?.social_links, {}),
      languages: parseJson(profile?.languages, ['pt-BR']),
    },
    skills,
    country_history: history,
    followers_count: followers.c,
    following_count: following.c,
    posts_count: posts.c,
  });
});

export default router;
