import express from 'express';
import cors from 'cors';
import { getDb } from './db/database.js';
import { expireStaleAdvertisements } from './lib/advertisements.js';
import { uploadsDir } from './lib/uploads.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import usersRoutes from './routes/users.js';
import businessesRoutes from './routes/businesses.js';
import socialRoutes from './routes/social.js';
import messagesRoutes from './routes/messages.js';
import miscRoutes from './routes/misc.js';
import geoRoutes from './routes/geo.js';
import communityRoutes from './routes/community.js';
import adminRoutes from './routes/admin.js';

let appPromise: Promise<express.Express> | null = null;

export function getApp(): Promise<express.Express> {
  if (!appPromise) appPromise = createApp();
  return appPromise;
}

async function createApp(): Promise<express.Express> {
  const db = await getDb();
  await expireStaleAdvertisements(db);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use('/uploads', express.static(uploadsDir));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'comunidade-br-api' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/posts', postsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/businesses', businessesRoutes);
  app.use('/api/social', socialRoutes);
  app.use('/api/conversations', messagesRoutes);
  app.use('/api/geo', geoRoutes);
  app.use('/api/community', communityRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', miscRoutes);

  return app;
}
