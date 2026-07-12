import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Move, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { mediaUrl } from '@/lib/api';
import {
  type CoverPosition,
  COVER_SCALE_MAX,
  COVER_SCALE_MIN,
  COVER_SCALE_STEP,
  coverImageStyle,
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

function clampScale(n: number) {
  return Math.min(COVER_SCALE_MAX, Math.max(COVER_SCALE_MIN, Math.round(n * 100) / 100));
}

export function CoverPositionModal({
  imageSrc,
  initialPosition,
  onCancel,
  onConfirm,
  confirming,
}: Props) {
  const { t } = useTranslation();
  const [pos, setPos] = useState<CoverPosition>(() => {
    if (typeof initialPosition === 'object' && initialPosition) {
      return {
        x: initialPosition.x,
        y: initialPosition.y,
        scale: clampScale(initialPosition.scale ?? 1),
      };
    }
    return parseCoverPosition(initialPosition as string | null | undefined);
  });
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
    setPos((current) => ({
      ...current,
      x: Math.min(100, Math.max(0, dragRef.current!.originX - dx)),
      y: Math.min(100, Math.max(0, dragRef.current!.originY - dy)),
    }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const setScale = (next: number) => {
    setPos((current) => ({ ...current, scale: clampScale(next) }));
  };

  const resolvedSrc = imageSrc.startsWith('blob:') || imageSrc.startsWith('data:')
    ? imageSrc
    : mediaUrl(imageSrc);

  const scalePct = Math.round(pos.scale * 100);

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
            onWheel={(e) => {
              e.preventDefault();
              setScale(pos.scale + (e.deltaY < 0 ? COVER_SCALE_STEP : -COVER_SCALE_STEP));
            }}
          >
            <img
              src={resolvedSrc}
              alt=""
              draggable={false}
              className="pointer-events-none h-full w-full object-cover will-change-transform"
              style={coverImageStyle(pos)}
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-black/50 to-transparent py-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white">
                <Move className="h-3.5 w-3.5" />
                {t('editProfile.dragToReposition')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              onClick={() => setScale(pos.scale - COVER_SCALE_STEP)}
              disabled={confirming || pos.scale <= COVER_SCALE_MIN}
              aria-label={t('editProfile.zoomOut')}
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={COVER_SCALE_MIN}
              max={COVER_SCALE_MAX}
              step={COVER_SCALE_STEP}
              value={pos.scale}
              disabled={confirming}
              onChange={(e) => setScale(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-brand-700"
              aria-label={t('editProfile.zoom')}
            />
            <button
              type="button"
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              onClick={() => setScale(pos.scale + COVER_SCALE_STEP)}
              disabled={confirming || pos.scale >= COVER_SCALE_MAX}
              aria-label={t('editProfile.zoomIn')}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <span className="w-12 text-right text-xs font-medium tabular-nums text-slate-600">
              {scalePct}%
            </span>
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
