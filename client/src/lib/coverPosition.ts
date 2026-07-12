export type CoverPosition = { x: number; y: number; scale: number };

export const COVER_SCALE_MIN = 1;
export const COVER_SCALE_MAX = 2.5;
export const COVER_SCALE_STEP = 0.1;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function parseCoverPosition(value?: string | null): CoverPosition {
  if (!value) return { x: 50, y: 50, scale: 1 };
  const match = String(value)
    .trim()
    .match(/^([\d.]+)%\s+([\d.]+)%(?:\|([\d.]+))?$/);
  if (!match) return { x: 50, y: 50, scale: 1 };
  return {
    x: clamp(Number(match[1]), 0, 100),
    y: clamp(Number(match[2]), 0, 100),
    scale: clamp(Number(match[3] || 1), COVER_SCALE_MIN, COVER_SCALE_MAX),
  };
}

export function formatCoverPosition(pos: CoverPosition): string {
  const x = Math.round(clamp(pos.x, 0, 100));
  const y = Math.round(clamp(pos.y, 0, 100));
  const scale = Math.round(clamp(pos.scale ?? 1, COVER_SCALE_MIN, COVER_SCALE_MAX) * 100) / 100;
  if (scale <= 1) return `${x}% ${y}%`;
  return `${x}% ${y}%|${scale}`;
}

export function coverObjectPosition(pos: CoverPosition | string | null | undefined): string {
  const parsed = typeof pos === 'string' || pos == null ? parseCoverPosition(pos) : pos;
  return `${Math.round(parsed.x)}% ${Math.round(parsed.y)}%`;
}

export function coverImageStyle(pos: CoverPosition | string | null | undefined): {
  objectPosition: string;
  transform?: string;
  transformOrigin?: string;
} {
  const parsed = typeof pos === 'string' || pos == null ? parseCoverPosition(pos) : pos;
  const scale = clamp(parsed.scale ?? 1, COVER_SCALE_MIN, COVER_SCALE_MAX);
  const origin = `${Math.round(parsed.x)}% ${Math.round(parsed.y)}%`;
  if (scale <= 1) {
    return { objectPosition: origin };
  }
  return {
    objectPosition: origin,
    transform: `scale(${scale})`,
    transformOrigin: origin,
  };
}
