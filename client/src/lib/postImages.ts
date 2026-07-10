import { cn } from '@/lib/utils';

export type PostImageSize = 's' | 'm' | 'l' | 'full';

export type PostImage = {
  url: string;
  size: PostImageSize;
};

export const POST_IMAGE_SIZES: PostImageSize[] = ['s', 'm', 'l', 'full'];

export function normalizePostImages(images: unknown): PostImage[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((item): PostImage | null => {
      if (typeof item === 'string' && item.trim()) {
        return { url: item, size: 'l' };
      }
      if (item && typeof item === 'object' && 'url' in item) {
        const raw = item as { url?: unknown; size?: unknown };
        const url = String(raw.url || '').trim();
        if (!url) return null;
        const size = POST_IMAGE_SIZES.includes(raw.size as PostImageSize)
          ? (raw.size as PostImageSize)
          : 'l';
        return { url, size };
      }
      return null;
    })
    .filter((item): item is PostImage => !!item);
}

export function postImageFrameClass(size: PostImageSize, className?: string) {
  return cn(
    'overflow-hidden rounded-xl border border-slate-100 bg-slate-50',
    size === 's' && 'mx-auto w-full max-w-[220px]',
    size === 'm' && 'mx-auto w-full max-w-[360px]',
    size === 'l' && 'w-full max-w-2xl',
    size === 'full' && 'w-full',
    className
  );
}

export function postImageImgClass(size: PostImageSize) {
  return cn(
    'w-full object-cover',
    size === 's' && 'max-h-40',
    size === 'm' && 'max-h-56',
    size === 'l' && 'max-h-96',
    size === 'full' && 'max-h-[32rem]'
  );
}
