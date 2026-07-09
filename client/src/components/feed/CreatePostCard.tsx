import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Image, Calendar, Building2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

export function CreatePostCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = user?.full_name?.split(' ')[0] || '';

  return (
    <Card className="overflow-hidden border-slate-200/80 shadow-sm">
      <CardContent className="pt-4">
        <div
          className="cursor-pointer rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 transition-colors hover:bg-slate-50"
          onClick={() => navigate('/create-post')}
        >
          <span className="text-slate-400">
            {t('feed.whatsHappening', { name: firstName })}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <Button variant="ghost" size="sm" className="rounded-full text-slate-600" onClick={() => navigate('/create-post?type=image')}>
            <Image className="h-4 w-4 text-brand-600" />
            {t('feed.photo')}
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full text-slate-600" onClick={() => navigate('/create-post?type=event')}>
            <Calendar className="h-4 w-4 text-brand-600" />
            {t('feed.event')}
          </Button>
          <Button size="sm" className="ml-auto rounded-full" onClick={() => navigate('/promote-business')}>
            <Building2 className="h-4 w-4" />
            {t('feed.promoteBusiness')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
