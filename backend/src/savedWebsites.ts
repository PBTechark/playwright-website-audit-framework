import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { auditConfig } from './config';
import { ensureParentDir } from '../../utils/fileSystem';
import { SavedWebsite } from './apiTypes';

const CSV_HEADER = 'name,url,enabled,maxPages,maxDepth';

interface CsvRow {
  name?: string;
  url?: string;
  enabled?: string;
  maxPages?: string;
  maxDepth?: string;
}

/**
 * Enabled rows from the master targets CSV. Read-only on purpose: the engine's
 * readAuditTargets() creates a sample CSV when none exists, which a GET must not do.
 */
export function readSavedWebsites(): SavedWebsite[] {
  const csvPath = auditConfig.targetsCsvPath;
  if (!fs.existsSync(csvPath)) return [];
  const rows = parse(fs.readFileSync(csvPath, 'utf-8'), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as CsvRow[];
  return rows
    .filter((row) => row.url && URL.canParse(row.url))
    .filter((row) => !['false', 'no', 'n', '0', 'off'].includes((row.enabled ?? '').toLowerCase()))
    .map((row) => ({
      name: row.name || new URL(row.url as string).hostname,
      url: row.url as string,
      maxPages: positiveOr(row.maxPages, auditConfig.defaultMaxPages),
      maxDepth: positiveOr(row.maxDepth, auditConfig.defaultMaxDepth)
    }));
}

/** Writes the single-target CSV the engine reads for one audit run (via TARGETS_CSV). */
export function writeRunTargetCsv(
  csvPath: string,
  target: { name: string; url: string; maxPages: number; maxDepth: number }
): void {
  const row = [target.name, target.url, 'true', target.maxPages, target.maxDepth].map(csvCell).join(',');
  ensureParentDir(csvPath);
  fs.writeFileSync(csvPath, `${CSV_HEADER}\n${row}\n`, 'utf-8');
}

function positiveOr(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
