import { createServer } from 'http';
import { Server } from 'socket.io';
import { getApp } from './app.js';
import { setSocketIO } from './routes/messages.js';

const PORT = Number(process.env.PORT) || 3001;

async function start() {
  const app = await getApp();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  setSocketIO(io);

  io.on('connection', (socket) => {
    socket.on('join_conversation', (conversationId: string) => {
      socket.join(conversationId);
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`🚀 API Comunidade Brasil rodando em http://localhost:${PORT}`);
    console.log(`📦 Banco Postgres/Neon conectado`);
    console.log(`👤 Demo: ana@demo.com / demo123`);
  });
}

start().catch((err) => {
  console.error('Falha ao iniciar API:', err);
  process.exit(1);
});
