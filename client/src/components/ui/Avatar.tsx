import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Avatar({
  src,
  name,
  className,
  loading: externalLoading,
}: {
  src?: string | null;
  name: string;
  className?: string;
  loading?: boolean;
}) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const resolvedSrc = mediaUrl(src);

  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [resolvedSrc]);

  // Imagens em cache podem disparar onLoad antes do React registrar o handler
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
      setImageFailed(false);
    }
  }, [resolvedSrc]);

  const showPhoto = !!resolvedSrc && !imageFailed;
  const showSpinner = !!externalLoading && !showPhoto;

  return (
    <div
      className={cn(
        'relative aspect-square shrink-0 overflow-hidden rounded-full',
        showPhoto ? 'bg-brand-100' : 'bg-brand-200',
        className
      )}
    >
      {!showPhoto && (
        <div className="flex h-full w-full items-center justify-center font-semibold text-brand-800">
          {initials}
        </div>
      )}
      {showSpinner && (
        <div className="absolute inset-0 animate-pulse bg-brand-200" />
      )}
      {resolvedSrc && (
        <img
          ref={imgRef}
          src={resolvedSrc}
          alt={name}
          onLoad={() => {
            setImageLoaded(true);
            setImageFailed(false);
          }}
          onError={() => setImageFailed(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover object-center',
            showPhoto ? 'opacity-100' : 'opacity-0',
            !imageLoaded && showPhoto && 'bg-brand-100'
          )}
        />
      )}
    </div>
  );
}
