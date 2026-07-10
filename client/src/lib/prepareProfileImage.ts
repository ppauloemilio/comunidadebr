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
  const maxW = 1000;
  const maxH = 400;

  let width = img.width;
  let height = img.height;
  if (width > maxW) {
    height = (height * maxW) / width;
    width = maxW;
  }
  if (height > maxH) {
    width = (width * maxH) / height;
    height = maxH;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await compressJpeg(canvas, 180_000);
  return new File([blob], 'cover.jpg', { type: 'image/jpeg' });
}
