import express from 'express';
import cors from 'cors';
import { initDatabase } from './db/database';
import leadsRouter from './routes/leads';
import pipelineRouter from './routes/pipeline';
import analyticsRouter from './routes/analytics';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/leads', leadsRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/analytics', analyticsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nahv-backend', timestamp: new Date().toISOString() });
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Nahv Backend API draait op http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Database initialisatie mislukt:', err);
  process.exit(1);
});
