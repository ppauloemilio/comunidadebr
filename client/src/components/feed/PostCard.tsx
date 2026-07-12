import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Heart, MessageCircle, MoreHorizontal, MapPin, Trash2, Pencil, X, Reply, Repeat2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { PostRichEditor } from '@/components/post/PostRichEditor';
import { PostContent } from '@/components/post/PostContent';
import { ShareMenu } from '@/components/feed/ShareMenu';
import { timeAgo, COUNTRY_LABELS } from '@/lib/utils';
import {
  extractImagesFromHtml,
  isEditorEmpty,
  sanitizePostHtml,
} from '@/lib/postContent';
import type { PostImage } from '@/lib/postImages';
import { useAuth } from '@/hooks/useAuth';

export type Post = {
  id: string;
  content: string;
  type: string;
  images: Array<string | PostImage>;
  author_id: string;
  business_id: string | null;
  country: string;
  likes_count: number;
  comments_count: number;
  author_snapshot: {
    full_name: string;
    username: string;
    avatar_url?: string;
    city?: string;
    country?: string;
    is_premium?: boolean;
  };
  created_at: string;
  updated_at?: string | null;
  liked_by_me?: boolean;
  is_promoted?: boolean;
  author_is_premium?: boolean;
  shared_post_id?: string | null;
  shared_post?: Post | null;
};

type Comment = {
  id: string;
  content: string;
  author_id: string;
  parent_id: string | null;
  created_at: string;
  author_snapshot: {
    id?: string;
    full_name: string;
    username?: string;
    avatar_url?: string | null;
  };
};

type Liker = {
  id: string;
  user_id: string;
  created_at: string;
  user: {
    id: string;
    username: string;
    full_name: string;
    avatar_url: string | null;
  };
};

const COLLAPSE_LEN = 280;

function invalidatePostQueries(qc: ReturnType<typeof useQueryClient>, postId: string) {
  qc.invalidateQueries({ queryKey: ['posts'] });
  qc.invalidateQueries({ queryKey: ['user-posts'] });
  qc.invalidateQueries({ queryKey: ['comments', postId] });
  qc.invalidateQueries({ queryKey: ['post-likes', postId] });
}

export function PostCard({ post }: { post: Post }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);

  useEffect(() => {
    if (!editing) setEditContent(post.content);
  }, [post.content, editing]);

  const isOwner = user?.id === post.author_id;
  const snap = post.author_snapshot;
  const authorPremium = post.author_is_premium ?? snap.is_premium;
  const locationLabel = snap.city
    ? `${snap.city}, ${COUNTRY_LABELS[post.country] || post.country}`
    : COUNTRY_LABELS[post.country] || post.country;

  const likeMutation = useMutation({
    mutationFn: () =>
      post.liked_by_me
        ? api(`/posts/${post.id}/like`, { method: 'DELETE' })
        : api(`/posts/${post.id}/like`, { method: 'POST' }),
    onSuccess: () => invalidatePostQueries(qc, post.id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePostQueries(qc, post.id),
  });

  const editMutation = useMutation({
    mutationFn: () => {
      const html = sanitizePostHtml(editContent);
      const images = extractImagesFromHtml(html);
      return api<Post>(`/posts/${post.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content: html, images }),
      });
    },
    onSuccess: () => {
      setEditing(false);
      invalidatePostQueries(qc, post.id);
    },
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', post.id],
    queryFn: () => api<Comment[]>(`/posts/${post.id}/comments`),
    enabled: showComments,
  });

  const { data: likers = [], isLoading: loadingLikers } = useQuery({
    queryKey: ['post-likes', post.id],
    queryFn: () => api<Liker[]>(`/posts/${post.id}/likes`),
    enabled: showLikers,
  });

  const commentMutation = useMutation({
    mutationFn: () =>
      api(`/posts/${post.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          content: comment,
          parent_id: replyTo?.id || null,
        }),
      }),
    onSuccess: () => {
      setComment('');
      setReplyTo(null);
      invalidatePostQueries(qc, post.id);
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      api(`/posts/${post.id}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePostQueries(qc, post.id),
  });

  const threaded = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_id);
    const byParent = new Map<string, Comment[]>();
    for (const c of comments) {
      if (!c.parent_id) continue;
      const list = byParent.get(c.parent_id) || [];
      list.push(c);
      byParent.set(c.parent_id, list);
    }
    return roots.map((root) => ({ root, replies: byParent.get(root.id) || [] }));
  }, [comments]);

  return (
    <Card className="overflow-hidden border-slate-200/80 shadow-sm">
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-start gap-3">
          <Avatar name={post.author_snapshot.full_name} src={post.author_snapshot.avatar_url} className="h-11 w-11" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight">
              {post.author_snapshot.full_name}
              {authorPremium && (
                <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-800">
                  {t('admin.premium')}
                </span>
              )}
              {post.is_promoted && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                  {t('feed.promoted')}
                </span>
              )}
            </p>
            <p className="text-sm text-slate-500">@{post.author_snapshot.username}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-3 w-3" />
                {locationLabel}
              </span>
              <span>·</span>
              <span>{timeAgo(post.created_at, i18n.language)}</span>
              {post.updated_at && post.updated_at !== post.created_at && (
                <>
                  <span>·</span>
                  <span>{t('feed.edited')}</span>
                </>
              )}
            </div>
          </div>
          {isOwner && (
            <div className="relative">
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setMenuOpen(!menuOpen)}>
                <MoreHorizontal className="h-5 w-5 text-slate-400" />
              </Button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-10 min-w-[160px] rounded-lg border bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setEditContent(post.content);
                      setEditing(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    {t('feed.editPost')}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => {
                      deleteMutation.mutate();
                      setMenuOpen(false);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('common.delete')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-3">
            <PostRichEditor value={editContent} onChange={setEditContent} minHeightClass="min-h-[140px]" />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                className="rounded-full"
                onClick={() => {
                  setEditing(false);
                  setEditContent(post.content);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                className="rounded-full"
                disabled={
                  (!post.shared_post_id && isEditorEmpty(editContent)) || editMutation.isPending
                }
                onClick={() => editMutation.mutate()}
              >
                {t('feed.saveEdit')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {post.content?.trim() ? (
              <PostContent
                content={post.content}
                images={post.images}
                collapseLen={COLLAPSE_LEN}
                expanded={expanded}
                onExpand={() => setExpanded(true)}
                seeMoreLabel={t('feed.seeMore')}
              />
            ) : null}

            {post.shared_post && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
                <div className="flex items-center gap-2 border-b border-slate-200/80 px-3 py-2 text-xs font-medium text-slate-500">
                  <Repeat2 className="h-3.5 w-3.5" />
                  {t('feed.sharedPost')}
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-start gap-2">
                    <Avatar
                      name={post.shared_post.author_snapshot.full_name}
                      src={post.shared_post.author_snapshot.avatar_url}
                      className="h-9 w-9"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">
                        {post.shared_post.author_snapshot.full_name}
                      </p>
                      <p className="text-xs text-slate-500">
                        @{post.shared_post.author_snapshot.username}
                        {' · '}
                        {timeAgo(post.shared_post.created_at, i18n.language)}
                      </p>
                    </div>
                  </div>
                  <PostContent
                    content={post.shared_post.content}
                    images={post.shared_post.images}
                    collapseLen={280}
                    expanded
                    seeMoreLabel={t('feed.seeMore')}
                  />
                </div>
              </div>
            )}

            {!post.content?.trim() && !post.shared_post && (
              <PostContent
                content={post.content}
                images={post.images}
                collapseLen={COLLAPSE_LEN}
                expanded={expanded}
                onExpand={() => setExpanded(true)}
                seeMoreLabel={t('feed.seeMore')}
              />
            )}
          </>
        )}

        {(post.likes_count > 0 || post.comments_count > 0) && (
          <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm text-slate-500">
            <button
              type="button"
              className="hover:underline disabled:no-underline"
              disabled={post.likes_count === 0}
              onClick={() => setShowLikers(true)}
            >
              {post.likes_count > 0
                ? t('feed.likedByCount', { count: post.likes_count })
                : null}
            </button>
            <button
              type="button"
              className="hover:underline"
              onClick={() => setShowComments(true)}
            >
              {post.comments_count > 0
                ? t('feed.commentsCount', { count: post.comments_count })
                : null}
            </button>
          </div>
        )}

        <div className="flex gap-1 border-t border-slate-100 pt-2">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => likeMutation.mutate()}>
            <Heart className={`h-4 w-4 ${post.liked_by_me ? 'fill-red-500 text-red-500' : ''}`} />
            <span className="text-slate-600">{t('feed.like')}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => setShowComments(!showComments)}
          >
            <MessageCircle className="h-4 w-4" />
            <span className="text-slate-600">{t('feed.comment')}</span>
          </Button>
          <ShareMenu post={post} />
        </div>

        {showComments && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <p className="text-sm font-semibold text-slate-700">{t('feed.comments')}</p>

            {threaded.map(({ root, replies }) => (
              <div key={root.id} className="space-y-2">
                <CommentRow
                  comment={root}
                  canDelete={user?.id === root.author_id || isOwner}
                  onReply={() => {
                    setReplyTo(root);
                    setShowComments(true);
                  }}
                  onDelete={() => deleteCommentMutation.mutate(root.id)}
                  locale={i18n.language}
                  replyLabel={t('feed.reply')}
                  deleteLabel={t('common.delete')}
                />
                {replies.length > 0 && (
                  <div className="ml-10 space-y-2 border-l border-slate-100 pl-3">
                    {replies.map((reply) => (
                      <CommentRow
                        key={reply.id}
                        comment={reply}
                        canDelete={user?.id === reply.author_id || isOwner}
                        onReply={() => {
                          setReplyTo(root);
                          setShowComments(true);
                        }}
                        onDelete={() => deleteCommentMutation.mutate(reply.id)}
                        locale={i18n.language}
                        replyLabel={t('feed.reply')}
                        deleteLabel={t('common.delete')}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {replyTo && (
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span>
                  {t('feed.replyingTo', { name: replyTo.author_snapshot.full_name })}
                </span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label={t('common.cancel')}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <Avatar name={user?.full_name || 'U'} src={user?.avatar_url} className="mt-1 h-9 w-9" />
              <div className="flex flex-1 gap-2">
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={
                    replyTo
                      ? t('feed.writeReply', { name: replyTo.author_snapshot.full_name })
                      : t('feed.writeComment')
                  }
                  className="min-h-[60px] rounded-xl"
                />
                <Button
                  className="shrink-0 rounded-full self-end"
                  onClick={() => commentMutation.mutate()}
                  disabled={!comment.trim() || commentMutation.isPending}
                >
                  {replyTo ? t('feed.reply') : t('feed.comment')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {showLikers && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setShowLikers(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowLikers(false)}
          role="presentation"
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('feed.likesTitle')}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold">{t('feed.likesTitle')}</h3>
              <button type="button" onClick={() => setShowLikers(false)} className="rounded-full p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {loadingLikers && (
                <p className="py-8 text-center text-sm text-slate-500">{t('common.loading')}</p>
              )}
              {!loadingLikers && likers.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">{t('feed.noLikes')}</p>
              )}
              {likers.map((like) => (
                <div key={like.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-slate-50">
                  <Avatar name={like.user.full_name} src={like.user.avatar_url} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{like.user.full_name}</p>
                    {like.user.username && (
                      <p className="truncate text-sm text-slate-500">@{like.user.username}</p>
                    )}
                  </div>
                  <Heart className="h-4 w-4 fill-red-500 text-red-500" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function CommentRow({
  comment,
  canDelete,
  onReply,
  onDelete,
  locale,
  replyLabel,
  deleteLabel,
}: {
  comment: Comment;
  canDelete: boolean;
  onReply: () => void;
  onDelete: () => void;
  locale: string;
  replyLabel: string;
  deleteLabel: string;
}) {
  return (
    <div className="flex gap-2">
      <Avatar
        name={comment.author_snapshot.full_name}
        src={comment.author_snapshot.avatar_url}
        className="h-8 w-8"
      />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl bg-slate-100 px-3 py-2">
          <p className="text-sm font-semibold">{comment.author_snapshot.full_name}</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{comment.content}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 px-1 text-xs font-medium text-slate-500">
          <span>{timeAgo(comment.created_at, locale)}</span>
          <button type="button" className="hover:underline" onClick={onReply}>
            <span className="inline-flex items-center gap-1">
              <Reply className="h-3 w-3" />
              {replyLabel}
            </span>
          </button>
          {canDelete && (
            <button type="button" className="text-red-600 hover:underline" onClick={onDelete}>
              {deleteLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
