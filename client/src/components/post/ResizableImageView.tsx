import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useCallback, useRef, useState } from 'react';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

function parseWidth(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return 100;
}

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const src = mediaUrl(String(node.attrs.src || ''));
  const widthPct = parseWidth(node.attrs.width);
  const align = (node.attrs.align as string) || 'center';
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(widthPct);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startX.current = event.clientX;
      startWidth.current = parseWidth(node.attrs.width);
      setDragging(true);

      const onMove = (e: PointerEvent) => {
        const parent = containerRef.current?.parentElement;
        const parentWidth = parent?.clientWidth || 1;
        const deltaPct = ((e.clientX - startX.current) / parentWidth) * 100;
        const next = Math.min(100, Math.max(20, startWidth.current + deltaPct));
        updateAttributes({ width: `${Math.round(next)}%` });
      };

      const onUp = () => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [node.attrs.width, updateAttributes]
  );

  if (!src) return null;

  return (
    <NodeViewWrapper
      className={cn(
        'my-2 flex w-full',
        align === 'left' && 'justify-start',
        align === 'center' && 'justify-center',
        align === 'right' && 'justify-end'
      )}
      data-drag-handle
      data-align={align}
    >
      <div
        ref={containerRef}
        className={cn(
          'group relative block max-w-full',
          selected && 'ring-2 ring-brand-500 ring-offset-2',
          dragging && 'select-none'
        )}
        style={{ width: `${widthPct}%` }}
      >
        <img
          src={src}
          alt=""
          className="h-auto w-full rounded-xl object-cover"
          draggable={false}
        />
        <span
          onPointerDown={onPointerDown}
          className={cn(
            'absolute bottom-2 right-2 flex h-7 w-7 cursor-ew-resize items-center justify-center rounded-full border border-white/80 bg-slate-900/70 text-[10px] font-bold text-white shadow',
            'opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
            selected && 'opacity-100'
          )}
          title="Redimensionar"
          role="presentation"
        >
          ⇆
        </span>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-3 cursor-ew-resize">
          <span
            onPointerDown={onPointerDown}
            className="pointer-events-auto absolute inset-y-2 right-0 w-2 cursor-ew-resize rounded-full bg-brand-600/0 hover:bg-brand-600/40"
            role="presentation"
          />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
