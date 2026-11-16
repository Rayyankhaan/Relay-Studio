import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createShortsPilotApp } from './backend/app.ts';
import { ensureShortsFolders, getShortsStageDir } from './backend/folders.ts';
import { runSchedulerTick, scanIncomingFolder } from './backend/scheduler.ts';
import { getSettings } from './database/db.ts';

async function startServer() {
  await ensureShortsFolders();
  const app = createShortsPilotApp();
  const PORT = Number(process.env.PORT) || 3000;

  // Periodic scheduler & folder scan tick (every 15 seconds)
  setInterval(() => {
    runSchedulerTick().catch((err) => {
      console.error('Scheduler tick error:', err);
    });
  }, 15000);

  // Native local folder watcher on shorts/incoming/
  let watchDebounce: ReturnType<typeof setTimeout> | null = null;
  try {
    const incomingDir = getShortsStageDir('incoming');
    fs.watch(incomingDir, () => {
      if (!getSettings().enableFolderWatcher) return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        scanIncomingFolder().catch((err) => {
          console.error('Incoming folder watch error:', err);
        });
      }, 2000);
    });
  } catch (err) {
    console.warn('Filesystem watcher unavailable; periodic folder polling active.', err);
  }

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ShortsPilot – Xavier Memes running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ShortsPilot server:', err);
  process.exit(1);
});
