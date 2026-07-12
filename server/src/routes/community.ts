import { Router } from 'express';
import { getDb, parseJson } from '../db/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { getMonetizationSettings } from '../lib/settings.js';

const router = Router();
const EXCLUDED = 'BR';

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['pt-BR', 'en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

function isPremiumNow(
  premiumEnabled: boolean,
  isPremium: number | boolean | null | undefined,
  premiumUntil: string | null | undefined
) {
  if (!premiumEnabled || !isPremium) return false;
  if (premiumUntil && new Date(premiumUntil) < new Date()) return false;
  return true;
}

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const db = await getDb();
    const filterCountry = (req.query.country as string)?.trim().toUpperCase() || '';
    const settings = await getMonetizationSettings();

    const meProfile = (await db.prepare(
      'SELECT current_country FROM public_profiles WHERE user_id = ?'
    ).get(req.user!.id)) as { current_country: string } | undefined;
    const currentCountry = (meProfile?.current_country || '').toUpperCase();

    const users = (await db.prepare(
      `SELECT u.id, u.full_name, u.username, u.avatar_url,
              p.bio, p.current_country, p.current_city, p.primary_skill,
              p.show_city_on_profile, p.is_premium, p.premium_until,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END AS is_following
       FROM users u
       JOIN public_profiles p ON p.user_id = u.id
       LEFT JOIN follows f ON f.follower_id = ? AND f.following_id = u.id
       WHERE COALESCE(u.is_active, 1) = 1
         AND p.current_country IS NOT NULL
         AND TRIM(p.current_country) != ''
         AND UPPER(TRIM(p.current_country)) != ?
         AND (? = '' OR UPPER(TRIM(p.current_country)) = ?)
       ORDER BY u.full_name ASC
       LIMIT 500`
    ).all(req.user!.id, EXCLUDED, filterCountry, filterCountry)) as Array<{
      id: string;
      full_name: string;
      username: string;
      avatar_url: string | null;
      bio: string;
      current_country: string;
      current_city: string;
      primary_skill: string;
      show_city_on_profile: number;
      is_premium: number;
      premium_until: string | null;
      is_following: number;
    }>;

    const businesses = (await db.prepare(
      `SELECT b.id, b.name, b.category, b.tagline, b.description, b.address, b.city, b.state, b.country,
              b.latitude, b.longitude, b.skills,
              u.id AS owner_id, u.full_name AS owner_name
       FROM businesses b
       JOIN users u ON u.id = b.owner_id
       WHERE b.is_active = 1
         AND b.country IS NOT NULL
         AND TRIM(b.country) != ''
         AND UPPER(TRIM(b.country)) != ?
         AND (? = '' OR UPPER(TRIM(b.country)) = ?)
       ORDER BY b.name ASC
       LIMIT 500`
    ).all(EXCLUDED, filterCountry, filterCountry)) as Array<{
      id: string;
      name: string;
      category: string;
      tagline: string;
      description: string;
      address: string;
      city: string;
      state: string;
      country: string;
      latitude: number | null;
      longitude: number | null;
      owner_id: string;
      owner_name: string;
      skills: string;
    }>;

    type Group = {
      code: string;
      name: string;
      people_count: number;
      business_count: number;
      users: Array<{
        id: string;
        full_name: string;
        username: string;
        avatar_url: string | null;
        bio: string;
        current_country: string;
        current_city: string;
        primary_skill: string;
        is_following: boolean;
        is_premium: boolean;
      }>;
      businesses: Array<{
        id: string;
        name: string;
        category: string;
        tagline: string;
        description: string;
        address: string;
        city: string;
        state: string;
        country: string;
        latitude: number | null;
        longitude: number | null;
        owner_id: string;
        owner_name: string;
        skills: string[];
      }>;
    };

    const groups = new Map<string, Group>();

    const ensure = (code: string) => {
      const key = code.toUpperCase();
      let g = groups.get(key);
      if (!g) {
        g = {
          code: key,
          name: countryName(key),
          people_count: 0,
          business_count: 0,
          users: [],
          businesses: [],
        };
        groups.set(key, g);
      }
      return g;
    };

    for (const u of users) {
      const code = String(u.current_country || '').trim().toUpperCase();
      if (!code || code === EXCLUDED) continue;
      const g = ensure(code);
      g.people_count += 1;
      g.users.push({
        id: u.id,
        full_name: u.full_name,
        username: u.username,
        avatar_url: u.avatar_url,
        bio: u.bio || '',
        current_country: code,
        current_city: u.show_city_on_profile ? u.current_city || '' : '',
        primary_skill: u.primary_skill || '',
        is_following: !!u.is_following,
        is_premium: isPremiumNow(settings.premium_profile_enabled, u.is_premium, u.premium_until),
      });
    }

    for (const b of businesses) {
      const code = String(b.country || '').trim().toUpperCase();
      if (!code || code === EXCLUDED) continue;
      const g = ensure(code);
      g.business_count += 1;
      g.businesses.push({
        id: b.id,
        name: b.name,
        category: b.category,
        tagline: b.tagline || '',
        description: b.description || '',
        address: b.address || '',
        city: b.city || '',
        state: b.state || '',
        country: code,
        latitude: b.latitude,
        longitude: b.longitude,
        owner_id: b.owner_id,
        owner_name: b.owner_name,
        skills: parseJson(b.skills, [] as string[]),
      });
    }

    // Premium users first within each country
    for (const g of groups.values()) {
      g.users.sort((a, b) => Number(b.is_premium) - Number(a.is_premium) || a.full_name.localeCompare(b.full_name));
    }

    const countries = [...groups.values()].sort(
      (a, b) => b.people_count + b.business_count - (a.people_count + a.business_count) || a.code.localeCompare(b.code)
    );

    const peopleTotal = countries.reduce((s, c) => s + c.people_count, 0);
    const businessTotal = countries.reduce((s, c) => s + c.business_count, 0);
    const currentCountryPeople =
      countries.find((c) => c.code === currentCountry)?.people_count || 0;

    res.json({
      stats: {
        people_count: peopleTotal,
        business_count: businessTotal,
        country_count: countries.length,
      },
      current_country: currentCountry && currentCountry !== EXCLUDED ? currentCountry : '',
      current_country_name:
        currentCountry && currentCountry !== EXCLUDED ? countryName(currentCountry) : '',
      current_country_people: Number(currentCountryPeople),
      top_countries: countries.slice(0, 10).map((c) => ({
        code: c.code,
        name: c.name,
        people_count: c.people_count,
        business_count: c.business_count,
      })),
      countries,
    });
  } catch (err) {
    console.error('Community route error:', err);
    res.status(500).json({ error: 'Falha ao carregar a comunidade' });
  }
});

export default router;
