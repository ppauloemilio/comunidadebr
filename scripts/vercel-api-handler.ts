import type { IncomingMessage, ServerResponse } from 'http';
import { getApp } from '../server/src/app';

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
};

let appPromise: ReturnType<typeof getApp> | null = null;

function getAppSafe() {
  if (!appPromise) {
    appPromise = getApp().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (!process.env.DATABASE_URL) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: 'DATABASE_URL não configurada na Vercel (Settings → Environment Variables).',
      }));
      return;
    }

    const method = (req.method || 'GET').toUpperCase();
    const contentType = String(req.headers['content-type'] || '');

    // JSON: lê o body aqui. Se o Express json() rodar com stream vazio, apaga o body.
    if (
      method !== 'GET' &&
      method !== 'HEAD' &&
      method !== 'OPTIONS' &&
      contentType.includes('application/json')
    ) {
      const raw = await readRequestBody(req);
      try {
        (req as IncomingMessage & { body?: unknown }).body = raw.length
          ? JSON.parse(raw.toString('utf8'))
          : {};
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'JSON inválido' }));
        return;
      }
    }

    const app = await getAppSafe();
    return app(req as never, res as never);
  } catch (err) {
    console.error('API handler error:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'Erro interno na API',
      }));
    }
  }
}
