import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { PostCard, type Post } from '@/components/feed/PostCard';

export function PostPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const { data: post, isLoading, error } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api<Post>(`/posts/${id}`),
    enabled: !!id,
  });

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-6">
      <Link to="/feed" className="inline-flex items-center gap-2 text-sm font-medium text-brand-800 hover:underline">
        <ArrowLeft className="h-4 w-4" />
        {t('feed.backToFeed')}
      </Link>

      {isLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {t('common.loading')}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 p-8 text-center text-sm text-red-700">
          {t('feed.postNotFound')}
        </div>
      )}

      {post && <PostCard post={post} />}
    </div>
  );
}
