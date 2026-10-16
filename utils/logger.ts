import fs from 'fs';
import path from 'path';
import { auditConfig } from '../config/auditConfig';
import { ensureDir } from './fileSystem';

type Level = 'INFO' | 'WARN' | 'ERROR';

export class Logger {
  private readonly logFile: string;

  constructor(private readonly scope: string) {
    ensureDir(auditConfig.logDir);
    this.logFile = path.join(auditConfig.logDir, 'audit.log');
  }

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string, error?: unknown): void {
    const suffix = error instanceof Error ? ` ${error.stack ?? error.message}` : error ? ` ${String(error)}` : '';
    this.write('ERROR', `${message}${suffix}`);
  }

  private write(level: Level, message: string): void {
    const line = `${new Date().toISOString()} [${level}] [${this.scope}] ${message}`;
    fs.appendFileSync(this.logFile, `${line}\n`, 'utf-8');
    if (level === 'ERROR') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
