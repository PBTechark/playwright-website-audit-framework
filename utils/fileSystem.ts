import fs from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureParentDir(filePath: string): void {
  ensureDir(path.dirname(filePath));
}

export function writeJsonFile<T>(filePath: string, data: T): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

export function listJsonFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(dirPath, file));
}

export function safeFileName(input: string, fallback = 'item'): string {
  const sanitized = sanitize(input.replace(/^https?:\/\//, '').replace(/[/?#=&:]+/g, '-')).replace(/-+/g, '-');
  return sanitized.slice(0, 140) || fallback;
}

export function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}
