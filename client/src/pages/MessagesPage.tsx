import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  Check,
  CheckCheck,
  FileText,
  Forward,
  Image as ImageIcon,
  MessageCircle,
  Pencil,
  Plus,
  Search,
  SendHorizontal,
  Smile,
  Trash2,
  MoreVertical,
  X,
} from 'lucide-react';
import { api, mediaUrl, uploadFile } from '@/lib/api';
import { EMOJI_CATEGORIES } from '@/lib/emojis';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

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
  last_message: {
    content: string;
    created_at: string;
    attachment_url?: string | null;
    sender_id?: string;
  } | null;
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
  is_read?: boolean;
};

type Friend = {
  id: string;
  requester_id: string;
  receiver_id: string;
  username: string;
  full_name: string;
  avatar_url?: string | null;
};

type ListFilter = 'all' | 'unread';

function friendUserId(friend: Friend, myId: string) {
  return friend.requester_id === myId ? friend.receiver_id : friend.requester_id;
}

function isImageUrl(url: string) {
  return /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url) || url.startsWith('data:image/');
}

function chatListTime(dateStr: string | undefined, locale: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startToday.getTime() - startMsg.getTime()) / 86400000);
  if (dayDiff === 0) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  if (dayDiff === 1) return locale.startsWith('en') ? 'Yesterday' : 'Ontem';
  if (dayDiff < 7) {
    return date.toLocaleDateString(locale, { weekday: 'short' });
  }
  return date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function bubbleTime(dateStr: string, locale: string) {
  return new Date(dateStr).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/** WhatsApp-like doodle wallpaper (subtle) */
const CHAT_BG = {
  backgroundColor: '#efeae2',
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'>
      <g fill='none' stroke='%23d5cdc0' stroke-width='1.2' opacity='0.45'>
        <path d='M30 40c8-2 14 6 10 12s-14 4-14-4 0-8 4-8'/>
        <circle cx='120' cy='50' r='8'/>
        <path d='M60 110h24M72 98v24'/>
        <rect x='130' y='120' width='18' height='14' rx='2'/>
        <path d='M40 150c10 0 16-8 16-14'/>
        <circle cx='95' cy='30' r='3'/>
        <path d='M150 70l10 8-10 8z'/>
      </g>
    </svg>`
  )}")`,
};

export function MessagesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('conversation');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<Message | null>(null);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [search, setSearch] = useState('');
  const [attachMenu, setAttachMenu] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState('');
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatSearchRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<Conversation[]>('/conversations'),
  });

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: async () => {
      const data = await api<Message[]>(`/conversations/${activeId}/messages`);
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages-count'] });
      return data;
    },
    enabled: !!activeId,
  });

  const { data: friends = [] } = useQuery({
    queryKey: ['friendships'],
    queryFn: () => api<Friend[]>('/social/friendships'),
    enabled: !!forwardMsg || newChatOpen,
  });

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  const unreadTotal = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
    [conversations]
  );

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (listFilter === 'unread' && !(c.unread > 0)) return false;
      if (!q) return true;
      const name = c.other_user?.full_name?.toLowerCase() || '';
      const username = c.other_user?.username?.toLowerCase() || '';
      const preview = c.last_message?.content?.toLowerCase() || '';
      return name.includes(q) || username.includes(q) || preview.includes(q);
    });
  }, [conversations, listFilter, search]);

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
      invalidateChat();
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: (conversationId: string) =>
      api(`/conversations/${conversationId}`, { method: 'DELETE' }),
    onSuccess: (_data, conversationId) => {
      setHeaderMenuOpen(false);
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['messages-count'] });
      qc.removeQueries({ queryKey: ['messages', conversationId] });
      if (activeId === conversationId) setSearchParams({});
    },
  });

  const confirmDeleteConversation = (conversationId: string) => {
    if (window.confirm(t('messages.deleteConversationConfirm'))) {
      deleteConversationMutation.mutate(conversationId);
    }
  };

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
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setSearchParams({ conversation: data.conversation_id });
    },
  });

  const startChatMutation = useMutation({
    mutationFn: (participantId: string) =>
      api<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ participant_ids: [participantId] }),
      }),
    onSuccess: (data) => {
      setNewChatOpen(false);
      qc.invalidateQueries({ queryKey: ['conversations'] });
      setSearchParams({ conversation: data.id });
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
    setAttachMenu(false);
    setEmojiOpen(false);
    setChatSearchOpen(false);
    setChatSearch('');
    setHeaderMenuOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (chatSearchOpen) chatSearchRef.current?.focus();
  }, [chatSearchOpen]);

  const handleSend = () => {
    const value = text.trim();
    if (!value || !activeId) return;
    if (editing) {
      editMutation.mutate({ id: editing.id, content: value });
      return;
    }
    sendMutation.mutate({ content: value });
    setEmojiOpen(false);
  };

  const handleAttach = async (file: File) => {
    if (!activeId) return;
    setUploading(true);
    setAttachMenu(false);
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
      if (imageRef.current) imageRef.current.value = '';
    }
  };

  const insertEmoji = (emoji: string) => {
    setText((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const visibleMessages = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.content?.toLowerCase().includes(q));
  }, [messages, chatSearch]);

  useEffect(() => {
    if (!chatSearch.trim() || visibleMessages.length === 0) return;
    const el = messageRefs.current[visibleMessages[visibleMessages.length - 1].id];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [chatSearch, visibleMessages]);

  const otherName = activeConversation?.other_user?.full_name || t('messages.conversation');
  const activeEmojiCategory =
    EMOJI_CATEGORIES.find((c) => c.id === emojiCategory) || EMOJI_CATEGORIES[0];

  return (
    <div className="flex h-full min-h-[calc(100vh-3.5rem)] overflow-hidden bg-white md:h-[calc(100vh-3.5rem-1.5rem)] md:rounded-xl md:border md:border-[#d1d7db] md:shadow-sm">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex w-full shrink-0 flex-col border-r border-[#e9edef] bg-white md:w-[380px]',
          activeId ? 'hidden md:flex' : 'flex'
        )}
      >
        <div className="flex items-center justify-between bg-[#f0f2f5] px-4 py-1.5">
          <h1 className="text-lg font-bold tracking-tight text-[#111b21]">{t('messages.title')}</h1>
          <button
            type="button"
            className="rounded-full p-1.5 text-[#54656f] hover:bg-[#e9edef]"
            aria-label={t('messages.newChat')}
            onClick={() => setNewChatOpen(true)}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-white px-3 pb-2 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#54656f]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('messages.searchPlaceholder')}
              className="h-9 w-full rounded-lg bg-[#f0f2f5] py-2 pl-10 pr-3 text-sm text-[#111b21] placeholder:text-[#667781] outline-none"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setListFilter('all')}
              className={cn(
                'rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
                listFilter === 'all' ? 'bg-[#e7fce3] text-[#008069]' : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
              )}
            >
              {t('messages.filterAll')}
            </button>
            <button
              type="button"
              onClick={() => setListFilter('unread')}
              className={cn(
                'rounded-full px-3 py-1 text-[13px] font-medium transition-colors',
                listFilter === 'unread' ? 'bg-[#e7fce3] text-[#008069]' : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
              )}
            >
              {t('messages.filterUnread')}
              {unreadTotal > 0 ? ` ${unreadTotal}` : ''}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-[#667781]">{t('messages.empty')}</p>
          ) : (
            filteredConversations.map((c) => {
              const name = c.other_user?.full_name || t('messages.unknownUser');
              const active = activeId === c.id;
              const time = chatListTime(c.last_message?.created_at || c.updated_at, i18n.language);
              return (
                <div
                  key={c.id}
                  className={cn(
                    'group flex w-full items-center gap-1 border-b border-[#f0f2f5] pr-1 transition-colors hover:bg-[#f5f6f6]',
                    active && 'bg-[#f0f2f5]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSearchParams({ conversation: c.id })}
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                  >
                    <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#111b21]">{name}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {c.unread > 0 && (
                        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#25d366] px-1 text-[10px] font-semibold text-white">
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      )}
                      <span
                        className={cn(
                          'text-[11px]',
                          c.unread > 0 ? 'font-medium text-[#25d366]' : 'text-[#667781]'
                        )}
                      >
                        {time}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-full p-1.5 text-[#667781] opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                    title={t('messages.deleteConversation')}
                    aria-label={t('messages.deleteConversation')}
                    disabled={deleteConversationMutation.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDeleteConversation(c.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Chat panel */}
      <section
        className={cn(
          'relative flex min-w-0 flex-1 flex-col bg-[#efeae2]',
          !activeId ? 'hidden md:flex' : 'flex'
        )}
      >
        {activeId ? (
          <>
            <header className="flex flex-col bg-[#f0f2f5]">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  className="mr-1 text-[#54656f] md:hidden"
                  onClick={() => setSearchParams({})}
                  aria-label={t('common.back')}
                >
                  ←
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-[#111b21]">{otherName}</p>
                </div>
                <button
                  type="button"
                  className={cn(
                    'rounded-full p-1.5 text-[#54656f] hover:bg-[#e9edef]',
                    chatSearchOpen && 'bg-[#e9edef] text-[#008069]'
                  )}
                  aria-label={t('messages.searchInChat')}
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setChatSearchOpen((v) => {
                      if (v) setChatSearch('');
                      return !v;
                    });
                  }}
                >
                  <Search className="h-5 w-5" />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    className={cn(
                      'rounded-full p-1.5 text-[#54656f] hover:bg-[#e9edef]',
                      headerMenuOpen && 'bg-[#e9edef]'
                    )}
                    aria-label={t('messages.messageActions')}
                    onClick={() => setHeaderMenuOpen((v) => !v)}
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                  {headerMenuOpen && (
                    <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-lg bg-white py-1 shadow-xl ring-1 ring-black/5">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
                        disabled={deleteConversationMutation.isPending}
                        onClick={() => activeId && confirmDeleteConversation(activeId)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t('messages.deleteConversation')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {chatSearchOpen && (
                <div className="border-t border-[#e9edef] px-3 py-1.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#54656f]" />
                    <input
                      ref={chatSearchRef}
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder={t('messages.searchInChatPlaceholder')}
                      className="h-8 w-full rounded-lg bg-white py-1 pl-8 pr-8 text-sm text-[#111b21] outline-none ring-1 ring-[#e9edef] focus:ring-[#25d366]"
                    />
                    {chatSearch && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[#667781]"
                        onClick={() => setChatSearch('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {chatSearch.trim() && (
                    <p className="mt-1 text-[11px] text-[#667781]">
                      {t('messages.searchResults', { count: visibleMessages.length })}
                    </p>
                  )}
                </div>
              )}
            </header>

            <div className="relative flex-1 overflow-y-auto px-4 py-2 md:px-16" style={CHAT_BG}>
              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="rounded-lg bg-white/80 px-4 py-2 text-sm text-[#667781] shadow-sm">
                    {t('messages.noMessagesYet')}
                  </p>
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="rounded-lg bg-white/80 px-4 py-2 text-sm text-[#667781] shadow-sm">
                    {t('messages.searchNoResults')}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {visibleMessages.map((m) => {
                    const mine = m.sender_id === user?.id;
                    const showText = m.content && m.content !== '📎' && !m.content.startsWith('📎 Anexo');
                    const highlight =
                      chatSearch.trim() &&
                      m.content?.toLowerCase().includes(chatSearch.trim().toLowerCase());
                    return (
                      <div
                        key={m.id}
                        ref={(el) => {
                          messageRefs.current[m.id] = el;
                        }}
                        className={cn('group flex', mine ? 'justify-end' : 'justify-start')}
                      >
                        <div
                          className={cn(
                            'relative max-w-[85%] rounded-md px-2 pb-1 pt-4 text-[13px] shadow-sm md:max-w-[65%]',
                            mine
                              ? 'rounded-tr-sm bg-[#d9fdd3] text-[#111b21]'
                              : 'rounded-tl-sm bg-white text-[#111b21]',
                            highlight && 'ring-2 ring-[#25d366]/50'
                          )}
                        >
                          <div className="absolute right-0.5 top-0.5 z-10 flex items-center gap-0.5 rounded bg-black/[0.04] px-0.5">
                            {mine && (
                              <button
                                type="button"
                                className="rounded p-0.5 text-[#54656f] hover:bg-white/80"
                                title={t('messages.edit')}
                                onClick={() => {
                                  setEditing(m);
                                  setText(m.content === '📎' ? '' : m.content.replace(/^Encaminhada:\s*/, ''));
                                  inputRef.current?.focus();
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              className="rounded p-0.5 text-[#54656f] hover:bg-white/80"
                              title={t('messages.forward')}
                              onClick={() => setForwardMsg(m)}
                            >
                              <Forward className="h-3 w-3" />
                            </button>
                            {mine && (
                              <button
                                type="button"
                                className="rounded p-0.5 text-red-500 hover:bg-red-50"
                                title={t('messages.delete')}
                                onClick={() => {
                                  if (window.confirm(t('messages.deleteConfirm'))) {
                                    deleteMutation.mutate(m.id);
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>

                          {m.attachment_url && (
                            <div className="mb-0.5 mt-0.5 pr-14">
                              {isImageUrl(m.attachment_url) ? (
                                <a href={mediaUrl(m.attachment_url)} target="_blank" rel="noreferrer">
                                  <img
                                    src={mediaUrl(m.attachment_url)}
                                    alt=""
                                    className="max-h-52 max-w-full rounded object-cover"
                                  />
                                </a>
                              ) : (
                                <a
                                  href={mediaUrl(m.attachment_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 rounded bg-black/5 px-2 py-1.5"
                                >
                                  <span className="flex h-8 w-8 items-center justify-center rounded bg-[#e74c3c] text-white">
                                    <FileText className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium">
                                      {m.content && m.content !== '📎'
                                        ? m.content.replace(/^Encaminhada:\s*/, '')
                                        : t('messages.attachment')}
                                    </span>
                                  </span>
                                </a>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap items-end gap-x-2 gap-y-0">
                            {showText && (
                              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-snug">
                                {m.content}
                              </p>
                            )}
                            <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 self-end pb-px text-[10px] leading-none text-[#667781]">
                              {m.updated_at && <span className="italic">{t('messages.edited')}·</span>}
                              {bubbleTime(m.created_at, i18n.language)}
                              {mine &&
                                (m.is_read ? (
                                  <CheckCheck className="h-3 w-3 text-[#53bdeb]" />
                                ) : (
                                  <Check className="h-3 w-3 text-[#667781]" />
                                ))}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {editing && (
              <div className="flex items-center justify-between border-t border-[#e9edef] bg-[#f0f2f5] px-4 py-2 text-sm text-[#111b21]">
                <div>
                  <p className="text-xs font-semibold text-[#008069]">{t('messages.editing')}</p>
                  <p className="truncate text-[#667781]">{editing.content}</p>
                </div>
                <button
                  type="button"
                  className="rounded-full p-1.5 hover:bg-[#e9edef]"
                  onClick={() => {
                    setEditing(null);
                    setText('');
                  }}
                >
                  <X className="h-5 w-5 text-[#54656f]" />
                </button>
              </div>
            )}

            <footer className="relative flex flex-col bg-[#f0f2f5]">
              {emojiOpen && (
                <div className="border-t border-[#e9edef] bg-white shadow-inner">
                  <div className="flex gap-1 overflow-x-auto border-b border-[#e9edef] px-2 py-1.5">
                    {EMOJI_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setEmojiCategory(cat.id)}
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium',
                          emojiCategory === cat.id
                            ? 'bg-[#e7fce3] text-[#008069]'
                            : 'bg-[#f0f2f5] text-[#54656f] hover:bg-[#e9edef]'
                        )}
                      >
                        {t(cat.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto p-2 sm:grid-cols-10 md:grid-cols-12">
                    {activeEmojiCategory.emojis.map((emoji) => (
                      <button
                        key={`${activeEmojiCategory.id}-${emoji}`}
                        type="button"
                        className="flex h-8 w-full items-center justify-center rounded text-xl hover:bg-[#f0f2f5]"
                        onClick={() => insertEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="relative flex items-end gap-1.5 px-2 py-1.5">
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAttach(file);
                  }}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.doc,.docx,.xls,.xlsx,.txt,image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleAttach(file);
                  }}
                />

                <div className="relative">
                  <button
                    type="button"
                    className="mb-0.5 rounded-full p-1.5 text-[#54656f] hover:bg-[#e9edef] disabled:opacity-50"
                    disabled={uploading || !!editing}
                    onClick={() => {
                      setEmojiOpen(false);
                      setAttachMenu((v) => !v);
                    }}
                    aria-label={t('messages.attach')}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                  {attachMenu && (
                    <div className="absolute bottom-10 left-0 z-20 w-44 overflow-hidden rounded-xl bg-white py-1 shadow-xl">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-[#f5f6f6]"
                        onClick={() => imageRef.current?.click()}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#007bfc] text-white">
                          <ImageIcon className="h-4 w-4" />
                        </span>
                        {t('messages.photos')}
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-[#f5f6f6]"
                        onClick={() => fileRef.current?.click()}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7f66ff] text-white">
                          <FileText className="h-4 w-4" />
                        </span>
                        {t('messages.document')}
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={cn(
                    'mb-0.5 rounded-full p-1.5 text-[#54656f] hover:bg-[#e9edef]',
                    emojiOpen && 'bg-[#e9edef] text-[#008069]'
                  )}
                  aria-label={t('messages.emoji')}
                  onClick={() => {
                    setAttachMenu(false);
                    setEmojiOpen((v) => !v);
                  }}
                >
                  <Smile className="h-5 w-5" />
                </button>

                <div className="flex min-w-0 flex-1 items-center rounded-lg bg-white px-3 py-1.5">
                  <input
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={editing ? t('messages.editPlaceholder') : t('messages.placeholder')}
                    className="w-full bg-transparent text-[14px] text-[#111b21] placeholder:text-[#667781] outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="mb-0.5 rounded-full p-1.5 text-[#54656f] hover:bg-[#e9edef] disabled:opacity-40"
                  onClick={handleSend}
                  disabled={!text.trim() || sendMutation.isPending || editMutation.isPending || uploading}
                  aria-label={editing ? t('common.save') : t('messages.send')}
                >
                  <SendHorizontal className="h-5 w-5" />
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-[#f0f2f5] px-8 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#e9edef] text-[#25d366]">
              <MessageCircle className="h-10 w-10" />
            </div>
            <h2 className="text-2xl font-light text-[#41525d]">{t('messages.welcomeTitle')}</h2>
            <p className="mt-3 max-w-md text-sm text-[#667781]">{t('messages.welcomeHint')}</p>
          </div>
        )}
      </section>

      {/* Forward modal */}
      {forwardMsg && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setForwardMsg(null)}
        >
          <div
            className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between bg-[#008069] px-4 py-3 text-white">
              <h2 className="font-medium">{t('messages.forwardTo')}</h2>
              <button type="button" className="rounded-full p-1 hover:bg-white/10" onClick={() => setForwardMsg(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[#667781]">
                {t('messages.conversations')}
              </p>
              {conversations
                .filter((c) => c.id !== activeId)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
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
                      className="h-10 w-10"
                    />
                    <span className="truncate text-sm font-medium">
                      {c.other_user?.full_name || t('messages.unknownUser')}
                    </span>
                  </button>
                ))}

              <p className="mt-3 px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[#667781]">
                {t('messages.friends')}
              </p>
              {friends.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-[#667781]">{t('messages.noFriends')}</p>
              ) : (
                friends.map((friend) => {
                  const fid = friendUserId(friend, user!.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
                      disabled={forwardMutation.isPending}
                      onClick={() =>
                        forwardMutation.mutate({
                          message: forwardMsg,
                          participantId: fid,
                        })
                      }
                    >
                      <Avatar name={friend.full_name} src={friend.avatar_url || undefined} className="h-10 w-10" />
                      <span className="truncate text-sm font-medium">{friend.full_name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* New chat */}
      {newChatOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setNewChatOpen(false)}
        >
          <div
            className="max-h-[70vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between bg-[#008069] px-4 py-3 text-white">
              <h2 className="font-medium">{t('messages.newChat')}</h2>
              <button type="button" className="rounded-full p-1 hover:bg-white/10" onClick={() => setNewChatOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {friends.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[#667781]">{t('messages.noFriends')}</p>
              ) : (
                friends.map((friend) => {
                  const fid = friendUserId(friend, user!.id);
                  return (
                    <button
                      key={friend.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
                      disabled={startChatMutation.isPending}
                      onClick={() => startChatMutation.mutate(fid)}
                    >
                      <Avatar name={friend.full_name} src={friend.avatar_url || undefined} className="h-10 w-10" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{friend.full_name}</p>
                      </div>
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
