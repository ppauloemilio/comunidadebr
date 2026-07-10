import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import type { Db } from '../db/database.js';
import { sendPasswordInviteEmail } from './email.js';

export const ADMIN_EMAIL = 'ppauloemilio@hotmail.com';
export const DEMO_ADMIN_EMAIL = 'ana@demo.com';

export async function promoteAdminByEmail(db: Db, email: string) {
  await db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
}

export async function createPasswordInvite(db: Db, userId: string, email: string): Promise<string> {
  const token = uuid();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(`INSERT INTO password_invites (id, user_id, token, email, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(uuid(), userId, token, email, expiresAt);
  return token;
}

export async function ensureAdminUser(db: Db) {
  await promoteAdminByEmail(db, DEMO_ADMIN_EMAIL);

  const existing = (await db.prepare('SELECT * FROM users WHERE email = ?').get(ADMIN_EMAIL)) as
    | { id: string; full_name: string; password_set: number }
    | undefined;

  if (existing) {
    await promoteAdminByEmail(db, ADMIN_EMAIL);
    return;
  }

  const id = uuid();
  const placeholderHash = bcrypt.hashSync(uuid(), 10);
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, username, full_name, is_admin, password_set)
     VALUES (?, ?, ?, ?, ?, 1, 0)`
    )
    .run(id, ADMIN_EMAIL, placeholderHash, 'paulo_admin', 'Paulo Emilio');

  await db.prepare('INSERT INTO public_profiles (user_id, current_country) VALUES (?, ?)').run(id, 'BR');
  await db
    .prepare('INSERT INTO user_country_history (id, user_id, country, joined_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), id, 'BR', new Date().toISOString());

  const token = await createPasswordInvite(db, id, ADMIN_EMAIL);
  await sendPasswordInviteEmail(ADMIN_EMAIL, token, 'Paulo Emilio');
}
