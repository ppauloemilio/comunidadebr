import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api, mediaUrl } from '@/lib/api';
import { useMonetization } from '@/hooks/useMonetization';
import { cn } from '@/lib/utils';

type Ad = {
  id: string;
  title: string;
  image_url: string;
  link_url?: string | null;
  description?: string | null;
  business_name?: string;
};

function AdContent({ ad, compact }: { ad: Ad; compact?: boolean }) {
  const { t } = useTranslation();
  const imageHeight = compact ? 'h-28' : 'h-40';

  return (
    <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-gradient-to-b from-amber-50/50 to-white shadow-sm">
      <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/80 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          {t('feed.featuredUser')}
        </span>
        <span className="text-[10px] text-amber-700/70">{t('feed.featuredUserHint')}</span>
      </div>

      {ad.image_url && (
        <img
          src={mediaUrl(ad.image_url)}
          alt={ad.description || ad.business_name || t('feed.featuredUser')}
          className={`${imageHeight} w-full object-cover`}
        />
      )}

      {ad.description && (
        <div className="px-3 py-2.5">
          <p
            className={
              compact
                ? 'text-xs leading-relaxed text-slate-600 line-clamp-2'
                : 'text-sm leading-relaxed text-slate-600'
            }
          >
            {ad.description}
          </p>
        </div>
      )}
    </div>
  );
}

function AdLink({ ad, children }: { ad: Ad; children: ReactNode }) {
  if (ad.link_url?.startsWith('/')) {
    return (
      <Link to={ad.link_url} className="block transition-opacity hover:opacity-95">
        {children}
      </Link>
    );
  }
  if (ad.link_url) {
    return (
      <a href={ad.link_url} target="_blank" rel="noopener noreferrer" className="block transition-opacity hover:opacity-95">
        {children}
      </a>
    );
  }
  return <>{children}</>;
}

export function AdBanner({ placement = 'feed' }: { placement?: 'feed' | 'sidebar' }) {
  const { t } = useTranslation();
  const { data: settings } = useMonetization();
  const { data: ads = [] } = useQuery({
    queryKey: ['advertisements', placement],
    queryFn: () => api<Ad[]>(`/advertisements?placement=${placement}`),
    enabled: settings?.ads_enabled,
    refetchInterval: 60_000,
  });

  const [index, setIndex] = useState(0);
  const rotationMs = (settings?.banner_rotation_seconds ?? 30) * 1000;

  useEffect(() => {
    setIndex(0);
  }, [ads.length, placement]);

  useEffect(() => {
    if (ads.length <= 1) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      timer = setInterval(() => {
        setIndex((i) => (i + 1) % ads.length);
      }, rotationMs);
    };

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      stop();
      if (document.visibilityState === 'visible') start();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ads.length, rotationMs]);

  if (!settings?.ads_enabled || ads.length === 0) return null;

  const ad = ads[index % ads.length];
  if (!ad) return null;

  const nextAd = ads.length > 1 ? ads[(index + 1) % ads.length] : null;
  if (nextAd?.image_url) {
    const img = new Image();
    img.src = mediaUrl(nextAd.image_url);
  }

  return (
    <div className="space-y-2">
      <AdLink ad={ad}>
        <AdContent ad={ad} compact={placement === 'sidebar'} />
      </AdLink>

      {ads.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {ads.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-label={t('feed.bannerDot', { index: i + 1, total: ads.length })}
              onClick={() => setIndex(i)}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === index ? 'w-4 bg-amber-600' : 'w-1.5 bg-amber-300 hover:bg-amber-400'
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
