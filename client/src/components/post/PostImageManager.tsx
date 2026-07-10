import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { mediaUrl, uploadFile } from '@/lib/api';
import {
  POST_IMAGE_SIZES,
  type PostImage,
  type PostImageSize,
  postImageFrameClass,
  postImageImgClass,
} from '@/lib/postImages';
import { cn } from '@/lib/utils';

type Props = {
  images: PostImage[];
  onChange: (images: PostImage[]) => void;
  className?: string;
};

export function PostImageManager({ images, onChange, className }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [defaultSize, setDefaultSize] = useState<PostImageSize>('l');

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      onChange([...images, { url, size: defaultSize }]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const setSize = (index: number, size: PostImageSize) => {
    onChange(images.map((img, i) => (i === index ? { ...img, size } : img)));
  };

  const removeAt = (index: number) => {
    onChange(images.filter((_, i) => i !== index));
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-brand-700 disabled:opacity-50"
        >
          <ImagePlus className="h-5 w-5" />
          {uploading ? t('common.loading') : t('post.addPhoto')}
        </button>
        <span className="text-xs text-slate-400">{t('post.imageSizeForNew')}</span>
        <div className="flex gap-1">
          {POST_IMAGE_SIZES.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setDefaultSize(size)}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-semibold uppercase',
                defaultSize === size
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {t(`post.imageSize_${size}`)}
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePick}
        />
      </div>

      {images.length > 0 && (
        <div className="space-y-3">
          {images.map((img, index) => (
            <div key={`${img.url}-${index}`} className="space-y-2 rounded-xl border border-slate-200 p-2">
              <div className={postImageFrameClass(img.size)}>
                <img
                  src={mediaUrl(img.url)}
                  alt=""
                  className={postImageImgClass(img.size)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">{t('post.imageSize')}</span>
                  {POST_IMAGE_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setSize(index, size)}
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-semibold uppercase',
                        img.size === size
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      {t(`post.imageSize_${size}`)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
