import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  Forward, MoreHorizontal, Paperclip, Pencil, Trash2, X,
} from 'lucide-react';
import { api, mediaUrl, uploadFile } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn, formatDate } from '@/lib/utils';

type OtherUser = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
};

type Conversation = {
  id: string;
  participant_ids: string[];
  other_user: OtherUser | null;
  last_message: { content: string; created_at: string; attachment_url?: string | null } | null;
  unread: number;
  updated_at?: string;
};

type Message = {
  id: string;
  sender_id: string;
  content: string;
  attachment_url?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type Friend = {
  id: string;
  requester_id: string;
  receiver_id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
};

function friendUserId(friend: Friend, myId: string) {
  return friend.requester_id === myId ? friend.receiver_id : friend.requester_id;
}

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url) || url.startsWith('data:image/');
}

export function MessagesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('conversation');
  const [text, setText] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('/conversations'),
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: async () => {
      const data = await api<Message[]>(`/conversations/${activeId}/messages`);
      // Opening a thread clears unread on the server — refresh the sidebar badges.
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages-count'] });
      return data;
    },
    enabled: !!activeId,
  });

  const { data: friends = [] } = useQuery({
    queryKey: ['friendships'],
    queryFn: () => api<Friend[]>('/social/friendships'),
    enabled: !!forwardMsg,
  });

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  const invalidateChat = () => {
    qc.invalidateQueries({ queryKey: ['messages', activeId] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['messages-count'] });
  };

  const sendMutation = useMutation({
    mutationFn: (body: { content?: string; attachment_url?: string }) =>
      api(`/conversations/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setText('');
      invalidateChat();
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api(`/conversations/${activeId}/messages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      setEditing(null);
      setText('');
      invalidateChat();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/conversations/${activeId}/messages/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMenuId(null);
      invalidateChat();
    },
  });

  const forwardMutation = useMutation({
    mutationFn: async ({
      message,
      conversationId,
      participantId,
    }: {
      message: Message;
      conversationId?: string;
      participantId?: string;
    }) =>
      api(`/conversations/${activeId}/messages/${message.id}/forward`, {
        method: 'POST',
        body: JSON.stringify(
          conversationId
            ? { conversation_id: conversationId }
            : { participant_ids: [participantId] }
        ),
      }),
    onSuccess: (data: { conversation_id: string }) => {
      setForwardMsg(null);
      setMenuId(null);
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setSearchParams({ conversation: data.conversation_id });
    },
  });

  useEffect(() => {
    if (!activeId) return;
    const socketBase = (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/$/, '');
    let socket: ReturnType<typeof io> | null = null;
    try {
      socket = io(socketBase, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 3000,
      });
      socket.on('connect_error', () => socket?.disconnect());
      socket.emit('join_conversation', activeId);
      const refresh = () => {
        qc.invalidateQueries({ queryKey: ['messages', activeId] });
        qc.invalidateQueries({ queryKey: ['conversations'] });
      };
      socket.on('new_message', refresh);
      socket.on('message_updated', refresh);
      socket.on('message_deleted', refresh);
    } catch {
      /* Vercel serverless */
    }
    return () => {
      socket?.disconnect();
    };
  }, [activeId, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setEditing(null);
    setText('');
    setMenuId(null);
  }, [activeId]);

  const handleSend = () => {
    const value = text.trim();
    if (!value || !activeId) return;
    if (editing) {
      editMutation.mutate({ id: editing.id, content: value });
      return;
    }
    sendMutation.mutate({ content: value });
  };

  const handleAttach = async (file: File) => {
    if (!activeId) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      await sendMutation.mutateAsync({
        content: file.type.startsWith('image/') ? '' : file.name,
        attachment_url: url,
      });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const otherName = activeConversation?.other_user?.full_name || t('messages.conversation');

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-4">
      <div className="w-full max-w-xs shrink-0 space-y-2 overflow-y-auto">
        <h1 className="text-xl font-bold">{t('messages.title')}</h1>
        {conversations.length === 0 ? (
          <p className="text-sm text-slate-500">{t('messages.empty')}</p>
        ) : (
          conversations.map((c) => {
            const name = c.other_user?.full_name || t('messages.unknownUser');
            const rawPreview = c.last_message?.content || '';
            const preview =
              c.last_message?.attachment_url && (!rawPreview || rawPreview === '📎' || rawPreview.startsWith('📎'))
                ? t('messages.attachment')
                : rawPreview || t('messages.noMessagesYet');
            return (
              <Card
                key={c.id}
                className={cn('cursor-pointer', activeId === c.id && 'border-brand-500 bg-brand-50/40')}
                onClick={() => setSearchParams({ conversation: c.id })}
              >
                <CardContent className="flex items-center gap-3 py-3">
                  <Avatar
                    name={name}
                    src={c.other_user?.avatar_url}
                    className="h-10 w-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                      {c.unread > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-500">{preview}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeId ? (
          <>
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <Avatar
                name={otherName}
                src={activeConversation?.other_user?.avatar_url}
                className="h-9 w-9"
              />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{otherName}</p>
                {activeConversation?.other_user?.username && (
                  <p className="truncate text-xs text-slate-500">
                    @{activeConversation.other_user.username}
                  </p>
                )}
              </div>
            </div>

            <CardContent className="flex-1 space-y-2 overflow-y-auto pt-4">
              {messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">{t('messages.noMessagesYet')}</p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_id === user?.id;
                  return (
                    <div key={m.id} className={cn('group flex', mine ? 'justify-end' : 'justify-start')}>
                      <div className="relative max-w-[75%]">
                        <div
                          className={cn(
                            'rounded-2xl px-3 py-2 text-sm',
                            mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'
                          )}
                        >
                          {m.attachment_url && (
                            <div className="mb-2">
                              {isImageUrl(m.attachment_url) ? (
                                <a href={mediaUrl(m.attachment_url)} target="_blank" rel="noreferrer">
                                  <img
                                    src={mediaUrl(m.attachment_url)}
                                    alt=""
                                    className="max-h-56 max-w-full rounded-lg object-cover"
                                  />
                                </a>
                              ) : (
                                <a
                                  href={mediaUrl(m.attachment_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={cn(
                                    'inline-flex items-center gap-1 underline',
                                    mine ? 'text-white' : 'text-brand-700'
                                  )}
                                >
                                  <Paperclip className="h-3.5 w-3.5" />
                                  {t('messages.openAttachment')}
                                </a>
                              )}
                            </div>
                          )}
                          {m.content && m.content !== '📎' && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                          <p className={cn('mt-1 text-[10px]', mine ? 'text-white/70' : 'text-slate-400')}>
                            {formatDate(m.created_at, i18n.language)}
                            {m.updated_at ? ` · ${t('messages.edited')}` : ''}
                          </p>
                        </div>

                        <div className={cn('absolute top-0', mine ? 'left-0 -translate-x-full pr-1' : 'right-0 translate-x-full pl-1')}>
                          <button
                            type="button"
                            className="rounded-full p-1 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
                            onClick={() => setMenuId(menuId === m.id ? null : m.id)}
                            aria-label={t('messages.messageActions')}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuId === m.id && (
                            <div className="absolute z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                              {mine && (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                                  onClick={() => {
                                    setEditing(m);
                                    setText(m.content === '📎' ? '' : m.content);
                                    setMenuId(null);
                                  }}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  {t('messages.edit')}
                                </button>
                              )}
                              {mine && (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                  onClick={() => {
                                    if (window.confirm(t('messages.deleteConfirm'))) {
                                      deleteMutation.mutate(m.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  {t('messages.delete')}
                                </button>
                              )}
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                                onClick={() => {
                                  setForwardMsg(m);
                                  setMenuId(null);
                                }}
                              >
                                <Forward className="h-3.5 w-3.5" />
                                {t('messages.forward')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </CardContent>

            {editing && (
              <div className="flex items-center justify-between border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                <span>{t('messages.editing')}</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium"
                  onClick={() => {
                    setEditing(null);
                    setText('');
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                  {t('common.cancel')}
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 border-t p-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAttach(file);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-full"
                disabled={uploading || !!editing}
                onClick={() => fileRef.current?.click()}
                aria-label={t('messages.attach')}
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={editing ? t('messages.editPlaceholder') : t('messages.placeholder')}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              />
              <Button
                className="rounded-full"
                onClick={handleSend}
                disabled={!text.trim() || sendMutation.isPending || editMutation.isPending || uploading}
              >
                {editing ? t('common.save') : '→'}
              </Button>
            </div>
          </>
        ) : (
          <CardContent className="flex flex-1 items-center justify-center text-slate-500">
            {t('messages.selectConversation')}
          </CardContent>
        )}
      </Card>

      {forwardMsg && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setForwardMsg(null)}
        >
          <div
            className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">{t('messages.forwardTo')}</h2>
              <button type="button" className="rounded-full p-1 hover:bg-slate-100" onClick={() => setForwardMsg(null)}>
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('messages.conversations')}
              </p>
              {conversations
                .filter((c) => c.id !== activeId)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                    disabled={forwardMutation.isPending}
                    onClick={() =>
                      forwardMutation.mutate({
                        message: forwardMsg,
                        conversationId: c.id,
                      })
                    }
                  >
                    <Avatar
                      name={c.other_user?.full_name || '?'}
                      src={c.other_user?.avatar_url}
                      className="h-9 w-9"
                    />
                    <span className="truncate text-sm font-medium">
                      {c.other_user?.full_name || t('messages.unknownUser')}
                    </span>
                  </button>
                ))}

              <p className="mt-3 px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t('messages.friends')}
              </p>
              {friends.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-500">{t('messages.noFriends')}</p>
              ) : (
                friends.map((friend) => {
                  const fid = friendUserId(friend, user!.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50"
                      disabled={forwardMutation.isPending}
                      onClick={() =>
                        forwardMutation.mutate({
                          message: forwardMsg,
                          participantId: fid,
                        })
                      }
                    >
                      <Avatar name={friend.full_name} src={friend.avatar_url || undefined} className="h-9 w-9" />
                      <span className="truncate text-sm font-medium">{friend.full_name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
