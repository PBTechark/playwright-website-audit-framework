import './env';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { backendConfig } from './config';
import { AuditRunner } from './auditRunner';
import { AuditStore } from './auditStore';
import { Auth } from './auth';
import { createApiRouter, errorHandler } from './routes';

const auth = Auth.fromEnv();
const store = new AuditStore();
const runner = new AuditRunner(store);
const app = express();

app.disable('x-powered-by');
// nginx on the same host terminates TLS; trust its X-Forwarded-* headers so req.ip (sign-in
// lockout) and req.secure (Secure cookie) reflect the real client instead of 127.0.0.1/http.
app.set('trust proxy', 'loopback');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Report pages replace this with their own policy (see sendReportHtml in routes.ts).
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
  });
  next();
});
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', createApiRouter(store, runner, auth));

// Serve the built frontend (npm run build in frontend/) from the same origin as the API.
const indexHtml = path.join(backendConfig.frontendDist, 'index.html');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(backendConfig.frontendDist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(indexHtml));
}
app.use(errorHandler);

const server = app.listen(backendConfig.port, backendConfig.host, () => {
  const url = `http://${backendConfig.host}:${backendConfig.port}`;
  console.log(`Website audit backend listening on ${url}`);
  console.log(fs.existsSync(indexHtml) ? `Dashboard: ${url}` : 'Frontend not built yet: run "npm run dev" in frontend/.');
});

function shutdown(): void {
  runner.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
