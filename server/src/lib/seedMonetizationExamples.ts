import type { DatabaseSync } from 'node:sqlite';
import { v4 as uuid } from 'uuid';
import { EXAMPLE_FEED_BANNER, EXAMPLE_SIDEBAR_BANNER } from './exampleSponsoredAd.js';
import { setMonetizationSettings } from './settings.js';

const DEMO_FLAG = 'monetization_examples_v3';

function insertBanner(
  db: DatabaseSync,
  data: {
    placement: 'feed' | 'sidebar';
    business_id: string;
    user_id: string;
    title: string;
    image_url: string;
    description: string;
    order_num: number;
    daysValid: number;
  }
) {
  const existing = db.prepare(
    `SELECT id FROM advertisements
     WHERE business_id = ? AND placement = ? AND is_active = 1 LIMIT 1`
  ).get(data.business_id, data.placement) as { id: string } | undefined;

  const endDate = new Date(Date.now() + data.daysValid * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  if (existing) {
    db.prepare(
      `UPDATE advertisements SET
       title = ?, image_url = ?, description = ?, user_id = ?, business_id = ?,
       link_url = '/business-map', is_active = 1, end_date = ?, source_type = 'user'
       WHERE id = ?`
    ).run(
      data.title,
      data.image_url,
      data.description,
      data.user_id,
      data.business_id,
      endDate,
      existing.id
    );
    return existing.id;
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO advertisements (
      id, title, image_url, link_url, description, is_active, order_num,
      placement, source_type, user_id, business_id, end_date
    ) VALUES (?, ?, ?, '/business-map', ?, 1, ?, ?, 'user', ?, ?, ?)`
  ).run(
    id,
    data.title,
    data.image_url,
    data.description,
    data.order_num,
    data.placement,
    data.user_id,
    data.business_id,
    endDate
  );
  return id;
}

export function applyMonetizationExamples(db: DatabaseSync) {
  setMonetizationSettings({
    ads_enabled: true,
    featured_business_enabled: true,
    paid_posts_enabled: true,
    premium_profile_enabled: true,
    banner_rotation_seconds: 30,
  });

  db.prepare(
    `UPDATE businesses
     SET is_featured = 1, featured_order = 0, featured_until = datetime('now', '+1 year')
     WHERE name = 'Sabor do Brasil'`
  ).run();

  db.prepare(
    `UPDATE posts
     SET is_promoted = 1, promoted_until = datetime('now', '+1 year')
     WHERE type = 'business_promo' OR content LIKE '%Promoção especial%'`
  ).run();

  const premiumUsernames = ['ana_silva', 'beatriz_paes'];
  for (const username of premiumUsernames) {
    const premiumUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
      | { id: string }
      | undefined;
    if (premiumUser) {
      db.prepare(
        `UPDATE public_profiles
         SET is_premium = 1, premium_until = datetime('now', '+1 year')
         WHERE user_id = ?`
      ).run(premiumUser.id);
    }
  }

  const sabor = db.prepare(
    `SELECT b.id AS business_id, b.name, b.owner_id, u.full_name
     FROM businesses b JOIN users u ON u.id = b.owner_id
     WHERE b.name = 'Sabor do Brasil' LIMIT 1`
  ).get() as { business_id: string; name: string; owner_id: string; full_name: string } | undefined;

  if (sabor) {
    insertBanner(db, {
      placement: 'feed',
      business_id: sabor.business_id,
      user_id: sabor.owner_id,
      title: sabor.name,
      image_url: EXAMPLE_FEED_BANNER.image_url,
      description: EXAMPLE_FEED_BANNER.description,
      order_num: EXAMPLE_FEED_BANNER.order_num,
      daysValid: EXAMPLE_FEED_BANNER.daysValid,
    });

    insertBanner(db, {
      placement: 'sidebar',
      business_id: sabor.business_id,
      user_id: sabor.owner_id,
      title: sabor.name,
      image_url: EXAMPLE_FEED_BANNER.image_url,
      description: EXAMPLE_SIDEBAR_BANNER.description,
      order_num: EXAMPLE_SIDEBAR_BANNER.order_num,
      daysValid: EXAMPLE_SIDEBAR_BANNER.daysValid,
    });
  }
}

export function seedMonetizationExamples(db: DatabaseSync) {
  const done = db.prepare('SELECT key FROM app_settings WHERE key = ?').get(DEMO_FLAG);
  if (done) return;

  applyMonetizationExamples(db);

  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(DEMO_FLAG, '1');

  console.log('✅ Exemplos de monetização aplicados (banners rotativos por negócio)');
}
