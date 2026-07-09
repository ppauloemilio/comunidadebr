import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AdminToggle } from '../AdminUi';
import { BannerSlotsPanel } from '../BannerSlotManager';
import type { MonetizationSettings } from '@/hooks/useMonetization';

export function MonetizationSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<MonetizationSettings>('/admin/settings'),
  });

  const saveSettings = useMutation({
    mutationFn: (patch: Partial<MonetizationSettings>) =>
      api('/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      qc.invalidateQueries({ queryKey: ['monetization-settings'] });
    },
  });

  const applyExamples = useMutation({
    mutationFn: () => api('/admin/monetization-examples', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      qc.invalidateQueries({ queryKey: ['monetization-settings'] });
      qc.invalidateQueries({ queryKey: ['advertisements'] });
      qc.invalidateQueries({ queryKey: ['admin-banner-slots'] });
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['businesses'] });
    },
  });

  if (isLoading || !settings) {
    return <p className="py-8 text-center text-slate-500">{t('common.loading')}</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <AdminToggle
            checked={settings.ads_enabled}
            onChange={(v) => saveSettings.mutate({ ads_enabled: v })}
            label={t('admin.adsEnabled')}
            hint={t('admin.adsHint')}
          />
          {settings.ads_enabled && (
            <label className="block rounded-xl border border-slate-200 p-4 text-sm">
              <span className="font-medium">{t('admin.bannerRotation')}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{t('admin.bannerRotationHint')}</span>
              <input
                type="number"
                min={5}
                max={120}
                className="mt-2 w-24 rounded-lg border border-slate-200 px-2 py-1"
                value={settings.banner_rotation_seconds ?? 30}
                onChange={(e) =>
                  saveSettings.mutate({ banner_rotation_seconds: Number(e.target.value) || 30 })
                }
              />
            </label>
          )}
          <AdminToggle
            checked={settings.featured_business_enabled}
            onChange={(v) => saveSettings.mutate({ featured_business_enabled: v })}
            label={t('admin.featuredBusinessEnabled')}
            hint={t('admin.featuredBusinessHint')}
          />
          <AdminToggle
            checked={settings.paid_posts_enabled}
            onChange={(v) => saveSettings.mutate({ paid_posts_enabled: v })}
            label={t('admin.paidPostsEnabled')}
            hint={t('admin.paidPostsHint')}
          />
          <AdminToggle
            checked={settings.premium_profile_enabled}
            onChange={(v) => saveSettings.mutate({ premium_profile_enabled: v })}
            label={t('admin.premiumEnabled')}
            hint={t('admin.premiumHint')}
          />
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">{t('admin.examplesTitle')}</p>
            <p className="mb-3 text-xs text-slate-500">{t('admin.examplesHint')}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={applyExamples.isPending}
              onClick={() => applyExamples.mutate()}
            >
              {applyExamples.isPending ? t('common.loading') : t('admin.applyExamples')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {settings.ads_enabled && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">{t('admin.bannersTitle')}</h3>
          <BannerSlotsPanel />
        </div>
      )}
    </div>
  );
}
