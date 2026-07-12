import DOMPurify from 'dompurify';
import type { PostImage } from '@/lib/postImages';

const HTML_TAG_RE = /<\/?(p|div|img|h[1-6]|ul|ol|li|blockquote|strong|em|a|br|span|u|code|pre)\b/i;

export function isRichHtml(content: string | null | undefined): boolean {
  if (!content) return false;
  return HTML_TAG_RE.test(content);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Converte texto/markdown antigo em HTML mínimo para o TipTap. */
export function toEditorHtml(content: string): string {
  if (!content?.trim()) return '';
  if (isRichHtml(content)) return content;
  return content
    .split('\n')
    .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
    .join('');
}

export function extractImagesFromHtml(html: string): PostImage[] {
  if (!html || typeof document === 'undefined') {
    // SSR / Node fallback via regex
    const out: PostImage[] = [];
    const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html))) {
      const tag = match[0];
      const widthMatch = tag.match(/width=["']?([\d.]+%?)["']?/i) || tag.match(/width:\s*([\d.]+%)/i);
      const width = widthMatch?.[1] || '100%';
      const pct = parseFloat(width);
      let size: PostImage['size'] = 'full';
      if (pct <= 35) size = 's';
      else if (pct <= 55) size = 'm';
      else if (pct <= 80) size = 'l';
      out.push({ url: match[1], size });
    }
    return out;
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('img')).map((img) => {
    const widthAttr = img.getAttribute('width') || img.style.width || '100%';
    const pct = parseFloat(widthAttr) || 100;
    let size: PostImage['size'] = 'full';
    if (pct <= 35) size = 's';
    else if (pct <= 55) size = 'm';
    else if (pct <= 80) size = 'l';
    return { url: img.getAttribute('src') || '', size };
  }).filter((img) => !!img.url);
}

export function plainTextFromHtml(html: string): string {
  if (!html) return '';
  if (!isRichHtml(html)) return html;
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').trim();
}

export function sanitizePostHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['style', 'width', 'target', 'rel'],
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3',
      'code', 'pre', 'img', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'width', 'style', 'class', 'target', 'rel'],
  });
}

export function isEditorEmpty(html: string): boolean {
  const text = plainTextFromHtml(html);
  if (text.length > 0) return false;
  return !/<img\b/i.test(html);
}
