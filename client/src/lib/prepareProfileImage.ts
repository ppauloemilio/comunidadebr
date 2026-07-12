const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ImageValidationError = 'invalidType' | 'tooLarge';

export function validateImageFile(file: File): ImageValidationError | null {
  if (!ACCEPTED.has(file.type)) return 'invalidType';
  if (file.size > MAX_BYTES) return 'tooLarge';
  return null;
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('load failed'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('blob failed'))), type, quality);
  });
}

export async function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function compressJpeg(canvas: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  let quality = 0.82;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  while (blob.size > maxBytes && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }
  return blob;
}

export async function prepareAvatarImage(file: File): Promise<File> {
  const img = await loadImage(file);
  const crop = Math.min(img.width, img.height);
  const sx = (img.width - crop) / 2;
  const sy = (img.height - crop) / 2;
  const size = 256;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(img, sx, sy, crop, crop, 0, 0, size, size);
  const blob = await compressJpeg(canvas, 80_000);
  return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
}

export async function prepareCoverImage(file: File): Promise<File> {
  const img = await loadImage(file);
  // Mantém proporção com lado maior limitado — permite reposicionar no banner largo
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, width, height);
  const blob = await compressJpeg(canvas, 220_000);
  return new File([blob], 'cover.jpg', { type: 'image/jpeg' });
}
