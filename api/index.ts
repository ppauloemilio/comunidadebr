import { getApp } from '../server/src/app.js';

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: false,
  },
};

const appPromise = getApp();

export default async function handler(req: any, res: any) {
  const app = await appPromise;
  return app(req, res);
}
