import fs from 'fs';
import path from 'path';
import { ensureDir, readJsonFile, writeJsonFile } from '../../utils/fileSystem';
import { backendConfig } from './config';
import { AuditRecord } from './apiTypes';

const AUDIT_ID_PATTERN = /^AUD-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/;

/**
 * File-based audit history: backend/data/audits/<id>/ holds audit.json, the run log, progress
 * events and an artifacts/ snapshot of that run's reports and screenshots. Keeping it behind this
 * class means it can move to SQLite later without touching the routes.
 */
export class AuditStore {
  readonly rootDir = path.join(backendConfig.dataDir, 'audits');

  constructor() {
    ensureDir(this.rootDir);
  }

  isValidId(id: string): boolean {
    return AUDIT_ID_PATTERN.test(id);
  }

  dir(id: string): string {
    if (!this.isValidId(id)) throw new Error(`Invalid audit id: ${id}`);
    return path.join(this.rootDir, id);
  }

  artifactsDir(id: string): string {
    return path.join(this.dir(id), 'artifacts');
  }

  logPath(id: string): string {
    return path.join(this.dir(id), 'output.log');
  }

  progressPath(id: string): string {
    return path.join(this.dir(id), 'progress.jsonl');
  }

  targetsCsvPath(id: string): string {
    return path.join(this.dir(id), 'targets.csv');
  }

  save(record: AuditRecord): void {
    writeJsonFile(path.join(this.dir(record.id), 'audit.json'), record);
  }

  get(id: string): AuditRecord | null {
    if (!this.isValidId(id)) return null;
    return readJsonFile<AuditRecord | null>(path.join(this.dir(id), 'audit.json'), null);
  }

  list(): AuditRecord[] {
    return fs
      .readdirSync(this.rootDir)
      .filter((id) => this.isValidId(id))
      .map((id) => this.get(id))
      .filter((record): record is AuditRecord => Boolean(record))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
