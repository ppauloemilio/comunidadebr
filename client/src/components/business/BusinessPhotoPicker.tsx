import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, X } from 'lucide-react';
import { uploadFile } from '@/lib/api';

type Props = {
  photos: string[];
  onChange: (photos: string[]) => void;
};

export function BusinessPhotoPicker({ photos, onChange }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadFile(file);
      onChange([...photos, url]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = (url: string) => onChange(photos.filter((p) => p !== url));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{t('business.photos')}</p>
      <p className="text-xs text-slate-500">{t('business.photosHint')}</p>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((url) => (
            <div key={url} className="relative h-24 w-24 overflow-hidden rounded-lg border border-slate-200">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removePhoto(url)}
                className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white"
                aria-label={t('common.delete')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50"
      >
        <ImagePlus className="h-4 w-4" />
        {uploading ? t('common.loading') : t('business.addPhoto')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleImagePick}
      />
    </div>
  );
}
