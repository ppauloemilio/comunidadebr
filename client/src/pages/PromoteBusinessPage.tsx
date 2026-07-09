import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function PromoteBusinessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data: businesses = [] } = useQuery({
    queryKey: ['my-businesses'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/businesses/mine'),
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('business.promote')}</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Promova seu negócio no feed</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">Crie um post do tipo "business_promo" para divulgar sua empresa na comunidade.</p>
          {businesses.map((b) => (
            <Button key={b.id} variant="outline" className="w-full justify-start" onClick={() => navigate('/create-post')}>
              Promover: {b.name}
            </Button>
          ))}
          {businesses.length === 0 && (
            <Button onClick={() => navigate('/create-business')}>{t('business.create')}</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
