import { useTranslation } from 'react-i18next';
import { BannerSlotsPanel } from '../BannerSlotManager';

export function AdsSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('admin.adsSectionIntro')}</p>
      <BannerSlotsPanel />
    </div>
  );
}
