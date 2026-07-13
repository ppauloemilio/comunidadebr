import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { createPgDb, type Db } from './pg.js';
import { seedDatabase } from './seed.js';
import { seedAppSettings } from '../lib/settings.js';
import { seedMonetizationExamples } from '../lib/seedMonetizationExamples.js';
import { ensureAdminUser } from '../lib/adminUser.js';

dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });
dotenv.config();

let pool: pg.Pool | null = null;
let db: Db | null = null;
let initPromise: Promise<Db> | null = null;

export type { Db };

export async function getDb(): Promise<Db> {
  if (db) return db;
  if (!initPromise) initPromise = initDb();
  return initPromise;
}

async function initDb(): Promise<Db> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida. Configure a connection string do Neon/Postgres.');
  }

  const cleanUrl = connectionString
    .replace(/[?&]channel_binding=[^&]*/g, '')
    .replace(/[?&]sslmode=[^&]*/g, '');

  pool = new pg.Pool({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
  });

  db = createPgDb(pool);
  await migrate(db);
  await seedDatabase(db);
  await seedAppSettings(db);
  await seedMonetizationExamples(db);
  await patchProfileCities(db);
  await ensureAdminUser(db).catch((err) => console.error('Admin setup:', err));
  return db;
}

async function patchProfileCities(database: Db) {
  const patches: Array<[string, string, string]> = [
    ['ana_silva', 'New York', 'US'],
    ['carlos_mendes', 'New York', 'US'],
    ['julia_costa', 'São Paulo', 'BR'],
    ['pedro_lima', 'Lisboa', 'PT'],
    ['beatriz_paes', 'Berlin', 'DE'],
  ];
  const stmt = database.prepare(
    `UPDATE public_profiles SET current_city = ?, current_country = ?
     WHERE user_id = (SELECT id FROM users WHERE username = ?)`
  );
  for (const [username, city, country] of patches) {
    if (country) await stmt.run(city, country, username);
  }

  await database
    .prepare(
      `UPDATE public_profiles SET origin_city = ? WHERE user_id = (SELECT id FROM users WHERE username = 'ana_silva')`
    )
    .run('Salvador, Bahia');

  const ana = (await database.prepare(`SELECT id FROM users WHERE username = 'ana_silva'`).get()) as
    | { id: string }
    | undefined;
  if (ana) {
    const skillExists = await database.prepare('SELECT id FROM user_skills WHERE user_id = ? LIMIT 1').get(ana.id);
    if (!skillExists) {
      await database
        .prepare(
          'INSERT INTO user_skills (id, user_id, skill_name, proficiency_level, years_experience) VALUES (?, ?, ?, ?, ?)'
        )
        .run(uuid(), ana.id, 'Gastronomia', 'advanced', 5);
    }
  }
}

async function migrate(database: Db) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER DEFAULT 0,
      password_set INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS public_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT DEFAULT '',
      current_country TEXT DEFAULT 'BR',
      current_city TEXT DEFAULT '',
      origin_city TEXT DEFAULT '',
      origin_state TEXT DEFAULT '',
      current_state TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      primary_skill TEXT DEFAULT '',
      show_city_on_profile INTEGER DEFAULT 1,
      show_whatsapp_on_profile INTEGER DEFAULT 0,
      social_links TEXT DEFAULT '{}',
      languages TEXT DEFAULT '["pt-BR"]',
      is_premium INTEGER DEFAULT 0,
      premium_until TEXT
    );

    CREATE TABLE IF NOT EXISTS user_country_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      country TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      UNIQUE(user_id, country)
    );

    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS states (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      country_id TEXT NOT NULL REFERENCES countries(id)
    );

    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state_id TEXT REFERENCES states(id),
      country_id TEXT NOT NULL REFERENCES countries(id)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_name TEXT NOT NULL,
      proficiency_level TEXT DEFAULT 'intermediate',
      years_experience INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      country TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      address TEXT DEFAULT '',
      state TEXT DEFAULT '',
      city TEXT DEFAULT '',
      tagline TEXT DEFAULT '',
      description TEXT DEFAULT '',
      skills TEXT DEFAULT '[]',
      photos TEXT DEFAULT '[]',
      social_links TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      is_featured INTEGER DEFAULT 0,
      featured_until TEXT,
      featured_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      images TEXT DEFAULT '[]',
      author_id TEXT NOT NULL REFERENCES users(id),
      business_id TEXT REFERENCES businesses(id),
      country TEXT NOT NULL,
      likes_count INTEGER DEFAULT 0,
      comments_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_promoted INTEGER DEFAULT 0,
      promoted_until TEXT,
      author_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      author_snapshot TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      UNIQUE(post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      post_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      follower_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      UNIQUE(follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      UNIQUE(blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      UNIQUE(requester_id, receiver_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      is_read INTEGER DEFAULT 0,
      actor_snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS advertisements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      image_url TEXT NOT NULL,
      link_url TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      order_num INTEGER DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      placement TEXT DEFAULT 'feed',
      source_type TEXT DEFAULT 'user',
      user_id TEXT REFERENCES users(id),
      business_id TEXT REFERENCES businesses(id),
      created_at TEXT DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'user_user',
      business_id TEXT REFERENCES businesses(id),
      participant_ids TEXT NOT NULL,
      last_message TEXT,
      unread_count TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      attachment_url TEXT,
      is_read INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS password_invites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_posts_country ON posts(country, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  `);

  // Colunas extras para edição de posts, respostas e compartilhamentos
  try {
    await database.exec(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TEXT`);
    await database.exec(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS shared_post_id TEXT`);
    await database.exec(`ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id TEXT`);
    await database.exec(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at)`);
    await database.exec(`CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id, created_at)`);
  } catch (err) {
    console.error('Post/comment schema patch:', err);
  }

  try {
    await database.exec(`ALTER TABLE public_profiles ADD COLUMN IF NOT EXISTS cover_position TEXT DEFAULT '50% 50%'`);
    await database.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (NOW()::text),
        UNIQUE(blocker_id, blocked_id)
      )
    `);
    await database.exec(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TEXT`);
  } catch (err) {
    console.error('cover_position/blocks/messages schema patch:', err);
  }

  try {
    await database.exec(
      `UPDATE businesses SET city = 'New York', state = 'New York'
       WHERE TRIM(COALESCE(city, '')) = '' AND address LIKE '%New York%'`
    );
    await database.exec(
      `UPDATE businesses SET
         tagline = 'Restaurante típico de comida brasileira',
         description = 'Restaurante com comidas boas e baratas, aquelas que você sabe, matar aquela fome por um preço justo!'
       WHERE name = 'Sabor do Brasil' AND TRIM(COALESCE(description, '')) = ''`
    );
  } catch {
    /* ok */
  }
}

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  is_admin?: number;
  password_set?: number;
  is_active?: number;
  created_at: string;
};

export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function userSnapshot(user: {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  city?: string;
  country?: string;
}) {
  return JSON.stringify({
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    city: user.city || '',
    country: user.country || '',
  });
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    is_admin: !!user.is_admin,
    created_at: user.created_at,
  };
}
