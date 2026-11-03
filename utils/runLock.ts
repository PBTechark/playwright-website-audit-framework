import fs from 'fs';
import path from 'path';
import { auditConfig } from '../config/auditConfig';
import { ensureDir } from './fileSystem';

/**
 * Every run shares reports/, screenshots/ and the page inventory, so a second run in the same
 * folder silently wipes the first one's results. The lock file holds the running process id.
 */
const lockPath = path.join(auditConfig.reportsDir, '.audit-run.lock');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Process id of the audit currently running in this folder, or null. Locks left by crashed runs are ignored. */
export function runLockHolder(): number | null {
  if (!fs.existsSync(lockPath)) return null;
  const pid = Number(fs.readFileSync(lockPath, 'utf-8').trim());
  return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
}

export function acquireRunLock(): void {
  ensureDir(path.dirname(lockPath));
  if (runLockHolder() === process.pid) return;
  if (runLockHolder() === null) fs.rmSync(lockPath, { force: true });
  try {
    // 'wx' fails if another run created the lock first, so two runs starting together cannot both win.
    fs.writeFileSync(lockPath, String(process.pid), { encoding: 'utf-8', flag: 'wx' });
  } catch {
    throw new Error(
      `Another audit (process ${runLockHolder() ?? 'unknown'}) is already running in this folder. ` +
        'Wait for it to finish: runs share reports/, screenshots/ and the page inventory.'
    );
  }
}

export function releaseRunLock(): void {
  if (runLockHolder() === process.pid) fs.rmSync(lockPath, { force: true });
}
