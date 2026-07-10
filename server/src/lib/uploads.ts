import path from 'path';
import fs from 'fs';

/** Em Vercel o disco é efêmero — usa /tmp. Localmente usa server/src/uploads. */
export const uploadsDir =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join('/tmp', 'comunidade-uploads')
    : path.join(process.cwd(), 'server', 'src', 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });
