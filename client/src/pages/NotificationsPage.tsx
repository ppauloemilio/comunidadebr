import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate, cn } from '@/lib/utils';

type Notification = {
  id: string;
  type: string;
  actor_id: string;
  actor_snapshot: {
    id?: string;
    full_name: string;
    username?: string;
    avatar_url?: string;
  };
  created_at: string;
  is_read: boolean;
  i_follow_actor?: boolean;
  actor_blocked?: boolean;
};

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/social/notifications'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notifications-count'] });
  };

  const markAllMutation = useMutation({
    mutationFn: () => api('/social/notifications/read-all', { method: 'PATCH' }),
    onSuccess: invalidate,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api(`/social/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: invalidate,
  });

  const followBackMutation = useMutation({
    mutationFn: (userId: string) => api(`/social/follow/${userId}`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const blockMutation = useMutation({
    mutationFn: (userId: string) => api(`/social/block/${userId}`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const openProfile = (n: Notification, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const id = n.actor_id || n.actor_snapshot.id;
    if (!id) return;
    if (!n.is_read) markReadMutation.mutate(n.id);
    navigate(`/user/${id}`);
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('notifications.title')}</h1>
        {notifications.some((n) => !n.is_read) && (
          <Button variant="outline" size="sm" onClick={() => markAllMutation.mutate()}>
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>
      {isLoading ? (
        <p>{t('common.loading')}</p>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-slate-500">{t('notifications.empty')}</CardContent>
        </Card>
      ) : (
        notifications.map((n) => {
          const actorId = n.actor_id || n.actor_snapshot.id;
          const isFollow = n.type === 'follow';

          return (
            <Card
              key={n.id}
              className={cn(!n.is_read && 'border-brand-200 bg-brand-50/50')}
              onClick={() => !n.is_read && markReadMutation.mutate(n.id)}
            >
              <CardContent className="flex items-start gap-3 pt-4">
                <button type="button" className="shrink-0" onClick={(e) => openProfile(n, e)}>
                  <Avatar
                    name={n.actor_snapshot.full_name}
                    src={n.actor_snapshot.avatar_url}
                    className="h-10 w-10"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <button
                      type="button"
                      className="font-semibold text-brand-800 hover:underline"
                      onClick={(e) => openProfile(n, e)}
                    >
                      {n.actor_snapshot.full_name}
                    </button>{' '}
                    <span className="text-slate-700">
                      {t(`notifications.${n.type}` as 'notifications.like')}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatDate(n.created_at, i18n.language)}
                  </p>

                  {isFollow && actorId && !n.actor_blocked && (
                    <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                      {!n.i_follow_actor ? (
                        <Button
                          size="sm"
                          className="rounded-full"
                          disabled={followBackMutation.isPending}
                          onClick={() => followBackMutation.mutate(actorId)}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          {t('notifications.followBack')}
                        </Button>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                          {t('community.following')}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={blockMutation.isPending}
                        onClick={() => {
                          if (window.confirm(t('notifications.blockConfirm'))) {
                            blockMutation.mutate(actorId);
                          }
                        }}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {t('notifications.block')}
                      </Button>
                    </div>
                  )}

                  {isFollow && n.actor_blocked && (
                    <p className="mt-2 text-xs font-medium text-slate-500">
                      {t('notifications.blocked')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
