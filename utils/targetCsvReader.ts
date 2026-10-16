import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { auditConfig } from '../config/auditConfig';
import { ensureParentDir, safeFileName } from './fileSystem';
import { AuditTarget } from './types';

interface TargetCsvRow {
  name?: string;
  url?: string;
  enabled?: string;
  maxPages?: string;
  maxDepth?: string;
}

export function readAuditTargets(csvPath = auditConfig.targetsCsvPath): AuditTarget[] {
  const resolvedCsvPath = path.resolve(csvPath);
  if (!fs.existsSync(resolvedCsvPath)) {
    ensureParentDir(resolvedCsvPath);
    fs.writeFileSync(
      resolvedCsvPath,
      'name,url,enabled,maxPages,maxDepth\nexample,https://example.com,true,10,2\n',
      'utf-8'
    );
  }

  const rows = parse(fs.readFileSync(resolvedCsvPath, 'utf-8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as TargetCsvRow[];

  const names = new Map<string, number>();
  const targets = rows
    .map((row, index) => toAuditTarget(row, index + 2, names))
    .filter((target): target is AuditTarget => Boolean(target && target.enabled));

  if (targets.length === 0) {
    throw new Error(`No enabled audit targets found in ${resolvedCsvPath}`);
  }

  return targets;
}

function toAuditTarget(row: TargetCsvRow, lineNumber: number, names: Map<string, number>): AuditTarget | null {
  const enabled = parseEnabled(row.enabled);
  if (!enabled) {
    return null;
  }

  if (!row.url) {
    throw new Error(`Missing required url value in targets CSV line ${lineNumber}`);
  }

  const url = normalizeTargetUrl(row.url, lineNumber);
  const baseName = safeFileName(row.name?.trim() || new URL(url).hostname.replace(/^www\./, ''), `target-${lineNumber}`);
  const seen = names.get(baseName) ?? 0;
  names.set(baseName, seen + 1);

  return {
    name: seen > 0 ? `${baseName}-${seen + 1}` : baseName,
    url,
    enabled,
    maxPages: parsePositiveNumber(row.maxPages, auditConfig.defaultMaxPages),
    maxDepth: parsePositiveNumber(row.maxDepth, auditConfig.defaultMaxDepth)
  };
}

function normalizeTargetUrl(rawUrl: string, lineNumber: number): string {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only HTTP and HTTPS URLs are supported');
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid url in targets CSV line ${lineNumber}: ${message}`);
  }
}

function parseEnabled(value: string | undefined): boolean {
  if (!value) {
    return true;
  }
  return !['false', 'no', 'n', '0', 'off'].includes(value.trim().toLowerCase());
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
