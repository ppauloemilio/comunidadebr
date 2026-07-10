import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Em Vercel o disco é efêmero — usa /tmp. Localmente usa server/src/uploads. */
export const uploadsDir = process.env.VERCEL
  ? path.join('/tmp', 'comunidade-uploads')
  : path.join(__dirname, '../uploads');

fs.mkdirSync(uploadsDir, { recursive: true });
