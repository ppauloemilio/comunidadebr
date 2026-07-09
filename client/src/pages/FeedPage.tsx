import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PostCard, Post } from '@/components/feed/PostCard';
import { SearchHero } from '@/components/feed/SearchHero';
import { CreatePostCard } from '@/components/feed/CreatePostCard';
import { FeedSidebar } from '@/components/feed/FeedSidebar';
import { AdBanner } from '@/components/feed/AdBanner';
import { Card, CardContent } from '@/components/ui/Card';
import { cn, matchesFeedFilter, type FeedFilter } from '@/lib/utils';

const FILTERS: { key: FeedFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'feed.filterAll' },
  { key: 'posts', labelKey: 'feed.filterPosts' },
  { key: 'events', labelKey: 'feed.filterEvents' },
  { key: 'jobs', labelKey: 'feed.filterJobs' },
];

export function FeedPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FeedFilter>('all');

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['posts'],
    queryFn: () => api<Post[]>('/posts'),
  });

  const filtered = posts.filter((p) => matchesFeedFilter(p.type, filter));

  return (
    <div className="space-y-5">
      <SearchHero />

      <div className="flex gap-5 lg:gap-6">
        <div className="min-w-0 flex-[1.85] space-y-4">
          <CreatePostCard />

          <div className="flex flex-wrap gap-2">
            {FILTERS.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  filter === key
                    ? 'bg-brand-700 text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                )}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>

          {isLoading ? (
            <p className="text-center text-slate-500 py-8">{t('common.loading')}</p>
          ) : filtered.length === 0 ? (
            <Card className="border-slate-200/80">
              <CardContent className="py-12 text-center text-slate-500">{t('feed.empty')}</CardContent>
            </Card>
          ) : (
            filtered.map((post, i) => (
              <div key={post.id} className="space-y-4">
                {i === 0 && <AdBanner />}
                <PostCard post={post} />
              </div>
            ))
          )}
        </div>

        <FeedSidebar />
      </div>
    </div>
  );
}
