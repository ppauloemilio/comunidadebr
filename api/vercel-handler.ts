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
  if (!appPromise) appPromise = getApp();
  return appPromise;
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

    const app = await getAppSafe();
    return app(req as any, res as any);
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
