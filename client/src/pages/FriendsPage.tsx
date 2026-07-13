import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, UserMinus, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

type FriendRow = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
  status: string;
  direction?: 'incoming' | 'outgoing';
};

type Tab = 'friends' | 'incoming' | 'outgoing';

export function FriendsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('friends');

  const statusParam =
    tab === 'friends' ? 'accepted' : tab === 'incoming' ? 'pending_incoming' : 'pending_outgoing';

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['friendships', statusParam],
    queryFn: () => api<FriendRow[]>(`/social/friendships?status=${statusParam}`),
  });

  const { data: incomingCount = [] } = useQuery({
    queryKey: ['friendships', 'pending_incoming'],
    queryFn: () => api<FriendRow[]>('/social/friendships?status=pending_incoming'),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['friendships'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['profile'] });
  };

  const acceptMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/social/friendships/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'accepted' }),
      }),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/social/friendships/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'rejected' }),
      }),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api(`/social/friendships/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'friends', label: t('friends.tabFriends') },
    { key: 'incoming', label: t('friends.tabIncoming'), badge: incomingCount.length },
    { key: 'outgoing', label: t('friends.tabOutgoing') },
  ];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">{t('friends.title')}</h1>

      <div className="flex gap-1 rounded-full bg-slate-100 p-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors',
              tab === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            {item.label}
            {!!item.badge && item.badge > 0 && (
              <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-slate-500">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-slate-500">
            {tab === 'friends' && t('friends.emptyFriends')}
            {tab === 'incoming' && t('friends.emptyIncoming')}
            {tab === 'outgoing' && t('friends.emptyOutgoing')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-center gap-3 py-3">
                <button type="button" className="shrink-0" onClick={() => navigate(`/user/${row.user_id}`)}>
                  <Avatar name={row.full_name} src={row.avatar_url} className="h-11 w-11" />
                </button>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => navigate(`/user/${row.user_id}`)}
                >
                  <p className="truncate font-semibold text-slate-900">{row.full_name}</p>
                  <p className="truncate text-sm text-slate-500">@{row.username}</p>
                </button>
                <div className="flex shrink-0 gap-1.5">
                  {tab === 'incoming' && (
                    <>
                      <Button
                        size="sm"
                        className="rounded-full"
                        disabled={acceptMutation.isPending}
                        onClick={() => acceptMutation.mutate(row.id)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t('friends.accept')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate(row.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                        {t('friends.decline')}
                      </Button>
                    </>
                  )}
                  {tab === 'outgoing' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(row.id)}
                    >
                      {t('friends.cancelRequest')}
                    </Button>
                  )}
                  {tab === 'friends' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full text-red-600 hover:bg-red-50"
                      disabled={removeMutation.isPending}
                      onClick={() => {
                        if (window.confirm(t('friends.unfriendConfirm'))) {
                          removeMutation.mutate(row.id);
                        }
                      }}
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                      {t('friends.unfriend')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-center text-sm text-slate-500">
        <UserPlus className="mr-1 inline h-3.5 w-3.5" />
        {t('friends.hint')}
      </p>
    </div>
  );
}
