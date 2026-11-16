import 'dotenv/config';
import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { attachDemoOrSessionUser, registerAuthRoutes } from './server/auth';
import { initDatabase } from './server/db';
import { registerAdminAndOpsRoutes } from './server/routes/admin';
import { registerBillingRoutes } from './server/routes/billing';
import { registerBuilderRoutes } from './server/routes/builder';
import { registerDataCloudRoutes } from './server/routes/datacloud';
import { registerHostingRoutes } from './server/routes/hosting';
import { registerMarketplaceRoutes } from './server/routes/marketplace';

async function startServer() {
  initDatabase();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());
  app.use(attachDemoOrSessionUser);

  // Unified API Routes across all 4 Portals + Auth + Billing + Admin + Ops
  registerAuthRoutes(app);
  registerMarketplaceRoutes(app);
  registerBuilderRoutes(app);
  registerHostingRoutes(app);
  registerDataCloudRoutes(app);
  registerBillingRoutes(app);
  registerAdminAndOpsRoutes(app);

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'kodex-cloud', timestamp: new Date().toISOString() });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kodex Cloud unified server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Kodex Cloud server:', err);
  process.exit(1);
});
