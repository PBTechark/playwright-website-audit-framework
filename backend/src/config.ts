import './env';
import path from 'path';
import { auditConfig, viewportProjects } from '../../config/auditConfig';

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const backendConfig = {
  /** Bind to loopback by default: the API starts browser jobs, and sign-in is a single shared account. */
  host: process.env.BACKEND_HOST ?? '127.0.0.1',
  port: intFromEnv('BACKEND_PORT', 4300),
  engineRoot: auditConfig.rootDir,
  dataDir: path.resolve(__dirname, '..', 'data'),
  frontendDist: path.resolve(__dirname, '..', '..', 'frontend', 'dist'),
  /** Safe upper bounds enforced on every audit request, whatever the UI sends. */
  maxPagesLimit: intFromEnv('AUDIT_MAX_PAGES_LIMIT', 200),
  maxDepthLimit: intFromEnv('AUDIT_MAX_DEPTH_LIMIT', 6),
  workers: intFromEnv('AUDIT_WORKERS', 2),
  /**
   * Heap for the engine process. Report generation holds every result in memory: 200 pages x 5
   * viewports needs ~2 GB, while Node's default on a 4 GB server is ~1 GB.
   */
  engineHeapMb: intFromEnv('AUDIT_ENGINE_HEAP_MB', 2560),
  /** Hard stop for a job, slightly longer than Playwright's own global timeout. */
  jobTimeoutMs: intFromEnv('AUDIT_JOB_TIMEOUT_MS', auditConfig.globalTimeoutMs + 5 * 60 * 1000),
  /** Set to true only for trusted internal deployments that must audit intranet sites. */
  allowPrivateTargets: ['1', 'true', 'yes'].includes((process.env.AUDIT_ALLOW_PRIVATE_TARGETS ?? '').toLowerCase())
};

export { auditConfig, viewportProjects };
