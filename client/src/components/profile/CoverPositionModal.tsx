import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Move, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { mediaUrl } from '@/lib/api';
import {
  type CoverPosition,
  formatCoverPosition,
  parseCoverPosition,
} from '@/lib/coverPosition';
import { cn } from '@/lib/utils';

type Props = {
  imageSrc: string;
  initialPosition?: string | CoverPosition | null;
  onCancel: () => void;
  onConfirm: (position: CoverPosition) => void;
  confirming?: boolean;
};

export function CoverPositionModal({
  imageSrc,
  initialPosition,
  onCancel,
  onConfirm,
  confirming,
}: Props) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<CoverPosition>(() =>
    typeof initialPosition === 'object' && initialPosition
      ? initialPosition
      : parseCoverPosition(initialPosition as string | null | undefined)
  );
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, confirming]);

  const startDrag = (clientX: number, clientY: number) => {
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      originX: pos.x,
      originY: pos.y,
    };
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (!dragRef.current || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const dx = ((clientX - dragRef.current.startX) / rect.width) * 100;
    const dy = ((clientY - dragRef.current.startY) / rect.height) * 100;
    // Arrastar a imagem: o ponto de interesse se move no sentido oposto
    setPos({
      x: Math.min(100, Math.max(0, dragRef.current.originX - dx)),
      y: Math.min(100, Math.max(0, dragRef.current.originY - dy)),
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const resolvedSrc = imageSrc.startsWith('blob:') || imageSrc.startsWith('data:')
    ? imageSrc
    : mediaUrl(imageSrc);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('editProfile.repositionCover')}</h2>
            <p className="text-xs text-slate-500">{t('editProfile.repositionCoverHint')}</p>
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 hover:bg-slate-100"
            onClick={onCancel}
            disabled={confirming}
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div
            ref={frameRef}
            className={cn(
              'relative h-40 cursor-grab overflow-hidden rounded-xl bg-slate-900 select-none active:cursor-grabbing sm:h-48',
              confirming && 'pointer-events-none opacity-80'
            )}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startDrag(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => moveDrag(e.clientX, e.clientY)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img
              src={resolvedSrc}
              alt=""
              draggable={false}
              className="pointer-events-none h-full w-full object-cover"
              style={{ objectPosition: formatCoverPosition(pos) }}
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-black/50 to-transparent py-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white">
                <Move className="h-3.5 w-3.5" />
                {t('editProfile.dragToReposition')}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="rounded-full" onClick={onCancel} disabled={confirming}>
              {t('common.cancel')}
            </Button>
            <Button className="rounded-full" onClick={() => onConfirm(pos)} disabled={confirming}>
              {confirming ? t('common.loading') : t('editProfile.saveCoverPosition')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
