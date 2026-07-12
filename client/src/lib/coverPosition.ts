export type CoverPosition = { x: number; y: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function parseCoverPosition(value?: string | null): CoverPosition {
  if (!value) return { x: 50, y: 50 };
  const match = String(value).trim().match(/^([\d.]+)%\s+([\d.]+)%$/);
  if (!match) return { x: 50, y: 50 };
  return {
    x: clamp(Number(match[1]), 0, 100),
    y: clamp(Number(match[2]), 0, 100),
  };
}

export function formatCoverPosition(pos: CoverPosition): string {
  return `${Math.round(clamp(pos.x, 0, 100))}% ${Math.round(clamp(pos.y, 0, 100))}%`;
}

export function coverObjectPosition(pos: CoverPosition | string | null | undefined): string {
  const parsed = typeof pos === 'string' || pos == null ? parseCoverPosition(pos) : pos;
  return formatCoverPosition(parsed);
}
