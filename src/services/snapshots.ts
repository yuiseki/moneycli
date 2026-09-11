/**
 * The cache read as an archive.
 *
 * `loadMoney` answers one question: give me this day, fetching if it has to.
 * The MCP server never fetches, so it needs the other question too: which
 * days are there at all. Without that, a client can only guess dates and read
 * "no snapshot" back.
 */
import fs from 'fs';
import path from 'path';
import { loadCache } from '../storage';
import { type MoneySnapshot } from '../types';

const YEAR = /^\d{4}$/;
const TWO_DIGITS = /^\d{2}$/;

/** Directory entries matching a pattern, sorted, skipping anything else. */
function subdirectories(dir: string, pattern: RegExp): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // A cache directory that was never written is an empty archive, not a
    // failure: the CLI creates it on the first sync.
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Every day the cache holds for one provider, as yyyy-mm-dd, oldest first.
 *
 * The layout is <cache>/YYYY/MM/DD/<provider>/data.json, so a day counts only
 * when that provider's file is actually there; a day synced for a different
 * provider is a different archive.
 */
export function listCachedDays(cacheDir: string, provider: string): string[] {
  const days: string[] = [];

  for (const year of subdirectories(cacheDir, YEAR)) {
    for (const month of subdirectories(path.join(cacheDir, year), TWO_DIGITS)) {
      for (const day of subdirectories(path.join(cacheDir, year, month), TWO_DIGITS)) {
        const file = path.join(cacheDir, year, month, day, provider, 'data.json');
        if (fs.existsSync(file)) {
          days.push(`${year}-${month}-${day}`);
        }
      }
    }
  }

  return days.sort();
}

/** The newest cached day, or null when the archive is empty. */
export function latestCachedDay(cacheDir: string, provider: string): string | null {
  const days = listCachedDays(cacheDir, provider);
  return days.length > 0 ? days[days.length - 1] : null;
}

/** One day's snapshot, or null when it was never synced. */
export function loadSnapshot(
  cacheDir: string,
  dateKey: string,
  provider: string,
): MoneySnapshot | null {
  return loadCache(cacheDir, dateKey, provider);
}
