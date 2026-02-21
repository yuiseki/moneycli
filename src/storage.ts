import fs from 'fs';
import path from 'path';
import { parseDateKey } from './date';
import { type MoneySnapshot } from './types';

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeProviderName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isMoneySnapshot(value: unknown): value is MoneySnapshot {
  if (!isRecord(value)) return false;

  return (
    value.version === 1 &&
    typeof value.provider === 'string' &&
    typeof value.dateKey === 'string' &&
    typeof value.fetchedAt === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  );
}

export function getCacheDir(baseDir: string): string {
  ensureDirectory(baseDir);
  return baseDir;
}

export function getCachePath(cacheDir: string, dateKey: string, provider: string): string {
  const parts = parseDateKey(dateKey);
  return path.join(
    cacheDir,
    parts.year,
    parts.month,
    parts.day,
    sanitizeProviderName(provider),
    'data.json',
  );
}

export function loadCache(cacheDir: string, dateKey: string, provider: string): MoneySnapshot | null {
  const cachePath = getCachePath(cacheDir, dateKey, provider);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as unknown;
    if (!isMoneySnapshot(parsed)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function saveCache(
  cacheDir: string,
  dateKey: string,
  provider: string,
  snapshot: MoneySnapshot,
): string {
  const cachePath = getCachePath(cacheDir, dateKey, provider);
  ensureDirectory(path.dirname(cachePath));
  fs.writeFileSync(cachePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return cachePath;
}
