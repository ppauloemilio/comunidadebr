import { getDb, type Db } from '../db/database.js';

export type AdPlacement = 'feed' | 'sidebar';

export type AdvertisementRow = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  description: string | null;
  is_active: number;
  order_num: number;
  start_date: string | null;
  end_date: string | null;
  placement?: string;
  source_type?: string;
  user_id?: string | null;
  business_id?: string | null;
};

export type AdvertisementClient = {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  description: string | null;
  placement: AdPlacement;
  user_id: string;
  business_id: string;
  business_name?: string;
  user_name?: string;
  user_username?: string;
  is_active: boolean;
  order_num: number;
  start_date: string | null;
  end_date: string | null;
  is_expired?: boolean;
};

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400';

const ACTIVE_WHERE = `is_active = 1
  AND (start_date IS NULL OR start_date::date <= CURRENT_DATE)
  AND (end_date IS NULL OR end_date::date >= CURRENT_DATE)`;

export async function expireStaleAdvertisements(db: Db) {
  await db.prepare(
    `UPDATE advertisements SET is_active = 0
     WHERE is_active = 1 AND end_date IS NOT NULL AND end_date::date < CURRENT_DATE`
  ).run();
}

async function resolveBusiness(db: Db, businessId: string) {
  return (await db.prepare(
    `SELECT b.id, b.name, b.owner_id, u.full_name, u.username
     FROM businesses b
     JOIN users u ON u.id = b.owner_id
     WHERE b.id = ? AND b.is_active = 1 AND COALESCE(u.is_active, 1) = 1`
  ).get(businessId)) as
    | { id: string; name: string; owner_id: string; full_name: string; username: string }
    | undefined;
}

export async function enrichAdvertisement(db: Db, row: AdvertisementRow): Promise<AdvertisementClient> {
  const placement = (row.placement === 'sidebar' ? 'sidebar' : 'feed') as AdPlacement;
  const customImage = row.image_url?.trim();
  const expired = !!(row.end_date && new Date(row.end_date) < new Date(new Date().toISOString().slice(0, 10)));

  let business_name: string | undefined;
  let user_name: string | undefined;
  let user_username: string | undefined;
  let user_id = row.user_id || '';
  let business_id = row.business_id || '';

  if (row.business_id) {
    const biz = await resolveBusiness(db, row.business_id);
    if (biz) {
      business_name = biz.name;
      user_name = biz.full_name;
      user_username = biz.username;
      user_id = biz.owner_id;
      business_id = biz.id;
    }
  }

  return {
    id: row.id,
    title: row.title || business_name || '',
    image_url: customImage || PLACEHOLDER_IMAGE,
    link_url: row.link_url || (business_id ? '/business-map' : null),
    description: row.description?.trim() || null,
    placement,
    user_id,
    business_id,
    business_name,
    user_name,
    user_username,
    is_active: !!row.is_active && !expired,
    order_num: row.order_num ?? 0,
    start_date: row.start_date,
    end_date: row.end_date,
    is_expired: expired,
  };
}

export async function assertBusinessBannerSlot(
  db: Db,
  businessId: string,
  placement: AdPlacement,
  exceptId?: string
): Promise<{ ok: true } | { error: string }> {
  const params: string[] = [businessId, placement];
  let sql = `SELECT COUNT(*)::int as c FROM advertisements
    WHERE business_id = ? AND placement = ? AND ${ACTIVE_WHERE}`;
  if (exceptId) {
    sql += ' AND id != ?';
    params.push(exceptId);
  }
  const row = (await db.prepare(sql).get(...params)) as { c: number };
  if (row.c > 0) {
    return { error: 'Este negócio já possui um banner ativo nesta posição (feed ou sidebar).' };
  }
  return { ok: true };
}

export async function getActiveAdvertisements(placement: AdPlacement): Promise<AdvertisementClient[]> {
  const db = await getDb();
  await expireStaleAdvertisements(db);
  const rows = (await db.prepare(
    `SELECT * FROM advertisements WHERE placement = ? AND ${ACTIVE_WHERE}
     ORDER BY order_num ASC, title ASC`
  ).all(placement)) as AdvertisementRow[];
  return Promise.all(rows.map((row) => enrichAdvertisement(db, row)));
}

export async function resolveAdPayload(
  db: Db,
  body: {
    title?: string;
    image_url?: string;
    link_url?: string;
    description?: string;
    placement?: string;
    user_id?: string;
    business_id?: string;
    start_date?: string | null;
    end_date?: string | null;
  },
  options?: { exceptId?: string; activating?: boolean }
) {
  const placement = (body.placement === 'sidebar' ? 'sidebar' : 'feed') as AdPlacement;

  if (!body.business_id) return { error: 'Negócio obrigatório' as const };
  if (!body.user_id) return { error: 'Usuário pagante obrigatório' as const };

  const biz = await resolveBusiness(db, body.business_id);
  if (!biz) return { error: 'Negócio não encontrado' as const };
  if (biz.owner_id !== body.user_id) return { error: 'O usuário deve ser o dono do negócio' as const };

  if (!body.image_url?.trim()) return { error: 'Imagem do banner obrigatória' as const };

  if (options?.activating !== false) {
    const slot = await assertBusinessBannerSlot(db, biz.id, placement, options?.exceptId);
    if ('error' in slot) return slot;
  }

  if (options?.activating !== false && !body.end_date) {
    return { error: 'Data de expiração obrigatória (fim do período pago)' as const };
  }

  return {
    placement,
    user_id: biz.owner_id,
    business_id: biz.id,
    title: body.title?.trim() || biz.name,
    image_url: body.image_url.trim(),
    link_url: body.link_url?.trim() || '/business-map',
    description: body.description?.trim() || null,
    start_date: body.start_date || null,
    end_date: body.end_date || null,
  };
}
