import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Share2, Newspaper, Link2, MessageSquare, Smartphone, Check, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import type { Post } from '@/components/feed/PostCard';

type Friend = {
  id: string;
  requester_id: string;
  receiver_id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
};

function postUrl(postId: string) {
  return `${window.location.origin}/post/${postId}`;
}

function friendUserId(friend: Friend, myId: string) {
  return friend.requester_id === myId ? friend.receiver_id : friend.requester_id;
}

export function ShareMenu({ post }: { post: Post }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');

  const targetId = post.shared_post_id || post.id;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const { data: friends = [] } = useQuery({
    queryKey: ['friendships'],
    queryFn: () => api<Friend[]>('/social/friendships'),
    enabled: messageOpen,
  });

  const shareFeedMutation = useMutation({
    mutationFn: () =>
      api<Post>(`/posts/${targetId}/share`, {
        method: 'POST',
        body: JSON.stringify({ comment }),
      }),
    onSuccess: () => {
      setFeedOpen(false);
      setOpen(false);
      setComment('');
      setToast(t('feed.shareSuccess'));
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['user-posts'] });
      window.setTimeout(() => setToast(''), 2500);
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (friendId: string) => {
      const conversation = await api<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ participant_ids: [friendId] }),
      });
      const link = postUrl(targetId);
      const author = post.shared_post?.author_snapshot.full_name || post.author_snapshot.full_name;
      await api(`/conversations/${conversation.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: t('feed.shareMessageBody', { author, link }),
        }),
      });
      return conversation.id;
    },
    onSuccess: () => {
      setMessageOpen(false);
      setOpen(false);
      setToast(t('feed.shareSent'));
      qc.invalidateQueries({ queryKey: ['conversations'] });
      window.setTimeout(() => setToast(''), 2500);
    },
  });

  const copyLink = async () => {
    const url = postUrl(targetId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setToast(t('feed.linkCopied'));
      window.setTimeout(() => {
        setCopied(false);
        setToast('');
      }, 2000);
    } catch {
      setToast(t('common.error'));
      window.setTimeout(() => setToast(''), 2000);
    }
    setOpen(false);
  };

  const nativeShare = async () => {
    const url = postUrl(targetId);
    try {
      await navigator.share({
        title: t('app.name'),
        text: t('feed.shareNativeText', { name: post.author_snapshot.full_name }),
        url,
      });
      setOpen(false);
    } catch {
      /* usuário cancelou */
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen((v) => !v)}>
        <Share2 className="h-4 w-4" />
        <span className="text-slate-600">{t('feed.share')}</span>
      </Button>

      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setFeedOpen(true);
              setOpen(false);
            }}
          >
            <Newspaper className="h-4 w-4 text-brand-700" />
            {t('feed.shareToFeed')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={copyLink}
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Link2 className="h-4 w-4 text-slate-500" />}
            {t('feed.copyLink')}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setMessageOpen(true);
              setOpen(false);
            }}
          >
            <MessageSquare className="h-4 w-4 text-slate-500" />
            {t('feed.sendInMessage')}
          </button>
          {canNativeShare && (
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={nativeShare}
            >
              <Smartphone className="h-4 w-4 text-slate-500" />
              {t('feed.shareViaDevice')}
            </button>
          )}
        </div>
      )}

      {feedOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setFeedOpen(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">{t('feed.shareToFeed')}</h3>
              <button type="button" className="rounded-full p-1 hover:bg-slate-100" onClick={() => setFeedOpen(false)}>
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <p className="mb-3 text-sm text-slate-500">{t('feed.shareToFeedHint')}</p>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('feed.shareCommentPlaceholder')}
              className="min-h-[88px]"
            />
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <p className="font-medium text-slate-800">
                {(post.shared_post || post).author_snapshot.full_name}
              </p>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap">
                {String((post.shared_post || post).content || '')
                  .replace(/<[^>]+>/g, ' ')
                  .trim() || t('feed.sharedPost')}
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" className="rounded-full" onClick={() => setFeedOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                className="rounded-full"
                disabled={shareFeedMutation.isPending}
                onClick={() => shareFeedMutation.mutate()}
              >
                {t('feed.shareNow')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {messageOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setMessageOpen(false)}>
          <div
            className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-lg font-semibold text-slate-900">{t('feed.sendInMessage')}</h3>
              <button type="button" className="rounded-full p-1 hover:bg-slate-100" onClick={() => setMessageOpen(false)}>
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {friends.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">{t('feed.noFriendsToShare')}</p>
              ) : (
                friends.map((friend) => {
                  const fid = friendUserId(friend, user!.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      disabled={sendMessageMutation.isPending}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                      onClick={() => sendMessageMutation.mutate(fid)}
                    >
                      <Avatar name={friend.full_name} src={friend.avatar_url || undefined} className="h-10 w-10" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800">{friend.full_name}</p>
                        <p className="truncate text-sm text-slate-500">@{friend.username}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
