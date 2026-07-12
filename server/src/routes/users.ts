import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, parseJson, UserRow, type Db } from '../db/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { isPremiumProfile } from '../lib/settings.js';

const router = Router();

async function formatUser(user: UserRow, profile?: Record<string, unknown>, extra?: Record<string, unknown>) {
  const social = parseJson(profile?.social_links as string, {});
  const premiumActive = await isPremiumProfile(profile as { is_premium?: number; premium_until?: string | null });
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    cover_url: profile?.cover_url || '',
    created_at: user.created_at,
    bio: profile?.bio || '',
    current_country: profile?.current_country || 'BR',
    current_city: profile?.current_city || '',
    current_state: profile?.current_state || '',
    origin_city: profile?.origin_city || '',
    origin_state: profile?.origin_state || '',
    primary_skill: profile?.primary_skill || '',
    is_premium: premiumActive,
    show_city_on_profile: !!(profile?.show_city_on_profile ?? 1),
    show_whatsapp_on_profile: !!profile?.show_whatsapp_on_profile,
    social_links: social,
    languages: parseJson(profile?.languages as string, ['pt-BR']),
    ...extra,
  };
}

async function profileStats(db: Db, userId: string) {
  const followers = (await db.prepare('SELECT COUNT(*)::int as c FROM follows WHERE following_id = ?').get(userId)) as { c: number };
  const following = (await db.prepare('SELECT COUNT(*)::int as c FROM follows WHERE follower_id = ?').get(userId)) as { c: number };
  const posts = (await db.prepare('SELECT COUNT(*)::int as c FROM posts WHERE author_id = ? AND is_active = 1').get(userId)) as { c: number };
  return { followers_count: followers.c, following_count: following.c, posts_count: posts.c };
}

router.get('/', authMiddleware, async (req, res) => {
  const { q, country } = req.query;
  const db = await getDb();
  let users: UserRow[];

  if (q) {
    users = (await db.prepare(
      `SELECT u.* FROM users u
       LEFT JOIN public_profiles p ON p.user_id = u.id
       WHERE u.full_name LIKE ? OR u.username LIKE ?
       ${country ? 'AND p.current_country = ?' : ''}
       LIMIT 50`
    ).all(...(country ? [`%${q}%`, `%${q}%`, country] : [`%${q}%`, `%${q}%`]))) as UserRow[];
  } else if (country) {
    users = (await db.prepare(
      `SELECT u.* FROM users u
       JOIN public_profiles p ON p.user_id = u.id
       WHERE p.current_country = ? LIMIT 50`
    ).all(country)) as UserRow[];
  } else {
    users = (await db.prepare('SELECT * FROM users LIMIT 50').all()) as UserRow[];
  }

  res.json(
    await Promise.all(
      users.map(async (u) => {
        const profile = (await db.prepare('SELECT * FROM public_profiles WHERE user_id = ?').get(u.id)) as Record<string, unknown>;
        return formatUser(u, profile);
      })
    )
  );
});

router.get('/:id/posts', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const posts = await db.prepare(
    'SELECT * FROM posts WHERE author_id = ? AND is_active = 1 ORDER BY created_at DESC'
  ).all(req.params.id);

  const likes = (await db.prepare('SELECT post_id FROM likes WHERE user_id = ?').all(req.user!.id)) as { post_id: string }[];
  const likedSet = new Set(likes.map((l) => l.post_id));

  const authorProfile = (await db.prepare(
    'SELECT is_premium, premium_until FROM public_profiles WHERE user_id = ?'
  ).get(req.params.id)) as { is_premium: number; premium_until: string | null } | undefined;
  const authorIsPremium = await isPremiumProfile(authorProfile);

  const sharedIds = [...new Set(
    posts
      .map((p) => (p as { shared_post_id?: string }).shared_post_id)
      .filter(Boolean)
  )] as string[];
  const sharedById = new Map<string, Record<string, unknown>>();
  if (sharedIds.length) {
    const placeholders = sharedIds.map(() => '?').join(',');
    const sharedRows = (await db.prepare(
      `SELECT * FROM posts WHERE id IN (${placeholders}) AND is_active = 1`
    ).all(...sharedIds)) as Record<string, unknown>[];
    for (const row of sharedRows) sharedById.set(row.id as string, row);
  }

  res.json(
    posts.map((p) => {
      const row = p as Record<string, unknown>;
      const sharedId = (row.shared_post_id as string) || null;
      const sharedRow = sharedId ? sharedById.get(sharedId) : undefined;
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
        created_at: row.created_at,
        updated_at: row.updated_at || null,
        author_snapshot: {
          ...parseJson(row.author_snapshot as string, {}),
          is_premium: authorIsPremium,
        },
        author_is_premium: authorIsPremium,
        liked_by_me: likedSet.has(row.id as string),
        shared_post_id: sharedId,
        shared_post: sharedRow
          ? {
              id: sharedRow.id,
              content: sharedRow.content,
              type: sharedRow.type,
              images: parseJson(sharedRow.images as string, []),
              author_id: sharedRow.author_id,
              business_id: sharedRow.business_id,
              country: sharedRow.country,
              likes_count: sharedRow.likes_count,
              comments_count: sharedRow.comments_count,
              created_at: sharedRow.created_at,
              updated_at: sharedRow.updated_at || null,
              author_snapshot: parseJson(sharedRow.author_snapshot as string, {}),
              liked_by_me: likedSet.has(sharedRow.id as string),
              shared_post_id: null,
              shared_post: null,
            }
          : null,
      };
    })
  );
});

router.get('/:id/businesses', authMiddleware, async (req, res) => {
  const db = await getDb();
  const businesses = await db.prepare(
    'SELECT id, name, category, address, country FROM businesses WHERE owner_id = ? AND is_active = 1 ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(businesses);
});

router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const profile = (await db.prepare('SELECT * FROM public_profiles WHERE user_id = ?').get(user.id)) as Record<string, unknown>;
  const skills = await db.prepare('SELECT * FROM user_skills WHERE user_id = ?').all(user.id);
  const stats = await profileStats(db, user.id);

  if (req.user!.id !== user.id) {
    const isFollowing = await db.prepare(
      'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?'
    ).get(req.user!.id, user.id);
    const publicProfile = { ...(await formatUser(user, profile, stats)), skills, is_following: !!isFollowing };
    if (!publicProfile.show_city_on_profile) {
      publicProfile.current_city = '';
      publicProfile.current_state = '';
    }
    if (!publicProfile.show_whatsapp_on_profile && publicProfile.social_links) {
      const links = { ...(publicProfile.social_links as Record<string, string>) };
      delete links.whatsapp;
      publicProfile.social_links = links;
    }
    res.json(publicProfile);
    return;
  }

  res.json({ ...(await formatUser(user, profile, stats)), skills });
});

router.patch('/me/profile', authMiddleware, async (req: AuthRequest, res) => {
  const {
    full_name, bio, username, avatar_url, cover_url,
    current_country, current_state, current_city,
    origin_state, origin_city, primary_skill,
    show_city_on_profile, show_whatsapp_on_profile,
    social_links, languages,
  } = req.body;
  const db = await getDb();
  const userId = req.user!.id;

  if (full_name !== undefined) await db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name, userId);
  if (avatar_url !== undefined) {
    if (typeof avatar_url !== 'string' || avatar_url.length < 32) {
      return res.status(400).json({ error: 'Imagem de avatar inválida' });
    }
    await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatar_url, userId);
  }
  if (username) {
    const taken = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (taken) return res.status(409).json({ error: 'Username já em uso' });
    await db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
  }

  let profile = (await db.prepare('SELECT * FROM public_profiles WHERE user_id = ?').get(userId)) as Record<string, unknown> | undefined;
  if (!profile) {
    await db.prepare('INSERT INTO public_profiles (user_id, current_country) VALUES (?, ?)').run(userId, current_country || 'BR');
    profile = (await db.prepare('SELECT * FROM public_profiles WHERE user_id = ?').get(userId)) as Record<string, unknown>;
  }

  const profileUpdates: string[] = [];
  const profileParams: unknown[] = [];

  const setProfile = (column: string, value: unknown) => {
    if (value !== undefined) {
      profileUpdates.push(`${column} = ?`);
      profileParams.push(value);
    }
  };

  setProfile('bio', bio);
  if (cover_url !== undefined) {
    if (typeof cover_url !== 'string' || cover_url.length < 32) {
      return res.status(400).json({ error: 'Imagem de capa inválida' });
    }
    setProfile('cover_url', cover_url);
  }
  setProfile('current_country', current_country);
  setProfile('current_state', current_state);
  setProfile('current_city', current_city);
  setProfile('origin_state', origin_state);
  setProfile('origin_city', origin_city);
  setProfile('primary_skill', primary_skill);
  if (show_city_on_profile !== undefined) {
    profileUpdates.push('show_city_on_profile = ?');
    profileParams.push(show_city_on_profile ? 1 : 0);
  }
  if (show_whatsapp_on_profile !== undefined) {
    profileUpdates.push('show_whatsapp_on_profile = ?');
    profileParams.push(show_whatsapp_on_profile ? 1 : 0);
  }
  if (social_links !== undefined) {
    profileUpdates.push('social_links = ?');
    profileParams.push(JSON.stringify(social_links));
  }
  if (languages !== undefined) {
    profileUpdates.push('languages = ?');
    profileParams.push(JSON.stringify(languages));
  }

  if (profileUpdates.length > 0) {
    await db.prepare(
      `UPDATE public_profiles SET ${profileUpdates.join(', ')} WHERE user_id = ?`
    ).run(...profileParams, userId);
  }

  if (current_country) {
    const existing = await db.prepare(
      'SELECT id FROM user_country_history WHERE user_id = ? AND country = ?'
    ).get(userId, current_country);
    if (!existing) {
      await db.prepare('INSERT INTO user_country_history (id, user_id, country, joined_at) VALUES (?, ?, ?, ?)').run(
        uuid(), userId, current_country, new Date().toISOString()
      );
    }
  }

  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as UserRow;
  const updatedProfile = (await db.prepare('SELECT * FROM public_profiles WHERE user_id = ?').get(userId)) as Record<string, unknown>;
  res.json(await formatUser(user, updatedProfile, await profileStats(db, userId)));
});

router.post('/me/skills', authMiddleware, async (req: AuthRequest, res) => {
  const { skill_name, proficiency_level = 'intermediate', years_experience = 0 } = req.body;
  if (!skill_name) return res.status(400).json({ error: 'Skill obrigatória' });
  const db = await getDb();
  const existing = await db.prepare('SELECT id FROM user_skills WHERE user_id = ? AND skill_name = ?').get(req.user!.id, skill_name);
  if (existing) {
    await db.prepare('UPDATE user_skills SET proficiency_level = ?, years_experience = ? WHERE id = ?').run(
      proficiency_level, years_experience, (existing as { id: string }).id
    );
    return res.json({ ok: true });
  }
  const id = uuid();
  await db.prepare(
    'INSERT INTO user_skills (id, user_id, skill_name, proficiency_level, years_experience) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.user!.id, skill_name, proficiency_level, years_experience);
  res.status(201).json({ id, skill_name, proficiency_level, years_experience });
});

router.delete('/me/skills/:id', authMiddleware, async (req: AuthRequest, res) => {
  const db = await getDb();
  await db.prepare('DELETE FROM user_skills WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ ok: true });
});

export default router;
