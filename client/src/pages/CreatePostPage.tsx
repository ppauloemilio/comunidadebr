import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { PostRichEditor } from '@/components/post/PostRichEditor';
import { extractImagesFromHtml, isEditorEmpty, sanitizePostHtml } from '@/lib/postContent';
import { useCountryNameMap } from '@/components/explore/ExploreGeoFilters';
import { COUNTRY_LABELS } from '@/lib/utils';

type PostTypeOption = 'text' | 'job' | 'event';

type MeData = {
  full_name: string;
  avatar_url: string | null;
  profile?: {
    current_country: string;
    current_city: string;
    show_city_on_profile: boolean;
  };
};

const TYPE_FROM_PARAM: Record<string, PostTypeOption> = {
  text: 'text',
  image: 'text',
  job: 'job',
  event: 'event',
};

export function CreatePostPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const countryNames = useCountryNameMap();
  const [searchParams] = useSearchParams();

  const [content, setContent] = useState('');
  const [postType, setPostType] = useState<PostTypeOption>('text');

  useEffect(() => {
    const param = searchParams.get('type');
    if (param && TYPE_FROM_PARAM[param]) setPostType(TYPE_FROM_PARAM[param]);
  }, [searchParams]);

  const { data: me } = useQuery({
    queryKey: ['me-create-post'],
    queryFn: () => api<MeData>('/auth/me'),
    enabled: !!user,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const html = sanitizePostHtml(content);
      const images = extractImagesFromHtml(html);
      const type = images.length > 0 && postType === 'text' ? 'image' : postType;
      return api('/posts', {
        method: 'POST',
        body: JSON.stringify({ content: html, type, images }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      navigate('/feed');
    },
  });

  const displayName = me?.full_name || user?.full_name || '';
  const country = me?.profile?.current_country || '';
  const countryLabel = countryNames[country] || COUNTRY_LABELS[country] || country;
  const showCity = me?.profile?.show_city_on_profile !== false;
  const city = me?.profile?.current_city || '';
  const locationLabel = showCity && city ? `${city}, ${countryLabel}` : countryLabel;

  const postTypes: { value: PostTypeOption; label: string }[] = [
    { value: 'text', label: t('post.typeNormal') },
    { value: 'job', label: t('post.typeJob') },
    { value: 'event', label: t('post.typeEvent') },
  ];

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
          aria-label={t('common.back')}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold text-slate-900">{t('post.newPost')}</h1>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <Avatar name={displayName} src={me?.avatar_url ?? user?.avatar_url} className="h-12 w-12" />
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{displayName}</p>
              {locationLabel && (
                <p className="flex items-center gap-1 text-sm text-slate-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{locationLabel}</span>
                </p>
              )}
            </div>
          </div>

          <select
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
            value={postType}
            onChange={(e) => setPostType(e.target.value as PostTypeOption)}
          >
            {postTypes.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <PostRichEditor value={content} onChange={setContent} />

          <div className="flex items-center justify-end border-t border-slate-100 pt-4">
            <Button
              className="rounded-lg px-6"
              onClick={() => mutation.mutate()}
              disabled={isEditorEmpty(content) || mutation.isPending}
            >
              {t('post.publish')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
