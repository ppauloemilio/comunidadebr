import { ReactNode, useEffect, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

function CoverImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolved = mediaUrl(src);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [resolved]);

  return (
    <>
      {!loaded && !failed && (
        <div className="absolute inset-0 animate-pulse bg-brand-400/40" />
      )}
      <img
        src={resolved}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          'h-full w-full object-cover object-center transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
      />
      {failed && (
        <div className="absolute inset-0 bg-gradient-to-r from-brand-600 to-brand-500" />
      )}
    </>
  );
}

type EditableProps = {
  onCoverClick?: () => void;
  onAvatarClick?: () => void;
  coverLoading?: boolean;
  avatarLoading?: boolean;
};

type ProfileHeaderProps = {
  coverUrl?: string | null;
  avatarUrl?: string | null;
  name: string;
  username?: string;
  isPremium?: boolean;
  editable?: EditableProps;
  stats?: ReactNode;
  children?: ReactNode;
  tabs?: ReactNode;
  className?: string;
};

export function ProfileHeader({
  coverUrl,
  avatarUrl,
  name,
  username,
  isPremium,
  editable,
  stats,
  children,
  tabs,
  className,
}: ProfileHeaderProps) {
  return (
    <Card className={cn('border-slate-200/80 shadow-sm', className)}>
      <div className="group/cover relative h-36 overflow-hidden rounded-t-xl bg-brand-500 sm:h-44">
        {coverUrl ? (
          <CoverImage src={coverUrl} alt="" />
        ) : (
          <div className="h-full w-full bg-gradient-to-r from-brand-600 to-brand-500" />
        )}

        {editable?.onCoverClick && (
          <button
            type="button"
            onClick={editable.onCoverClick}
            disabled={editable.coverLoading}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/0 transition-colors group-hover/cover:bg-black/35"
            aria-label="Alterar foto de capa"
          >
            {editable.coverLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            ) : (
              <span className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-white opacity-0 transition-opacity group-hover/cover:opacity-100">
                <Camera className="h-4 w-4" />
              </span>
            )}
          </button>
        )}

        <div className="group/avatar absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
          <Avatar
            name={name}
            src={avatarUrl}
            loading={editable?.avatarLoading}
            className={cn(
              'relative h-16 w-16 ring-2 ring-white shadow-lg sm:h-20 sm:w-20',
              isPremium && 'ring-brand-300'
            )}
          />
          {editable?.onAvatarClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                editable.onAvatarClick?.();
              }}
              disabled={editable.avatarLoading}
              className="absolute inset-0 z-20 flex items-center justify-center rounded-full bg-black/0 transition-colors group-hover/avatar:bg-black/35"
              aria-label="Alterar foto de perfil"
            >
              {editable.avatarLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white shadow-md opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover/avatar:opacity-100">
                  <Camera className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 pt-4">
            <h1 className="text-xl font-bold sm:text-2xl">
              {name}
              {isPremium && (
                <span className="ml-2 align-middle rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">
                  Premium
                </span>
              )}
            </h1>
            {username && <p className="text-slate-500">@{username}</p>}
          </div>
          {stats}
        </div>
        {children}
      </div>
      {tabs}
    </Card>
  );
}
