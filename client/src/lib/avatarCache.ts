const PREFIX = 'comunidade_avatar_';

/** URLs /uploads/ na Vercel costumam 404 — não contam como avatar utilizável. */
export function isUsableAvatarUrl(url: string | null | undefined): url is string {
  if (!url || !url.trim()) return false;
  if (url.startsWith('/uploads/')) return false;
  return (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  );
}

export function readCachedAvatar(userId: string | null | undefined): string | null {
  if (!userId) return null;
  try {
    const value = localStorage.getItem(`${PREFIX}${userId}`);
    return isUsableAvatarUrl(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeCachedAvatar(userId: string | null | undefined, url: string | null | undefined) {
  if (!userId) return;
  try {
    if (isUsableAvatarUrl(url)) {
      localStorage.setItem(`${PREFIX}${userId}`, url);
    }
  } catch {
    /* quota exceeded — ignore */
  }
}

export function clearCachedAvatar(userId?: string | null) {
  if (!userId) return;
  try {
    localStorage.removeItem(`${PREFIX}${userId}`);
  } catch {
    /* ignore */
  }
}

export function pickBestAvatar(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (isUsableAvatarUrl(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return null;
}
