import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { getDb } from './db/database.js';
import { expireStaleAdvertisements } from './lib/advertisements.js';
import { uploadsDir } from './lib/uploads.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import usersRoutes from './routes/users.js';
import businessesRoutes from './routes/businesses.js';
import socialRoutes from './routes/social.js';
import messagesRoutes, { setSocketIO } from './routes/messages.js';
import miscRoutes from './routes/misc.js';
import geoRoutes from './routes/geo.js';
import communityRoutes from './routes/community.js';
import adminRoutes from './routes/admin.js';

const PORT = Number(process.env.PORT) || 3001;

getDb();
expireStaleAdvertisements(getDb());

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

setSocketIO(io);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

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

io.on('connection', (socket) => {
  socket.on('join_conversation', (conversationId: string) => {
    socket.join(conversationId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 API Comunidade Brasil rodando em http://localhost:${PORT}`);
  console.log(`📦 Banco SQLite criado automaticamente`);
  console.log(`👤 Demo: ana@demo.com / demo123`);
});
