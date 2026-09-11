/**
 * The month-keyed cash-flow cache.
 *
 * The day cache answers "what were the balances on this date". A month of
 * income and spending is not a property of a day: it keeps changing until the
 * month is over, and then it stops. So it gets its own key and its own
 * directory, under `months/` where the day layout's four-digit years cannot
 * collide with it.
 */
import fs from 'fs';
import path from 'path';
import { type MoneyForwardMonthData } from '../providers/money-forward/cash-flow';

export type MonthStatus = 'provisional' | 'confirmed';

export type MonthRecord = {
  version: 1;
  provider: string;
  month: string;
  fetchedAt: string;
  status: MonthStatus;
  data: MoneyForwardMonthData;
};

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

function parseMonthKey(month: string): { year: number; month: number } {
  const match = month.match(MONTH_KEY);
  if (!match) throw new Error(`'${month}' is not a month. Pass it as yyyy-mm.`);
  const value = Number(match[2]);
  if (value < 1 || value > 12) throw new Error(`'${month}' is not a month. Pass it as yyyy-mm.`);
  return { year: Number(match[1]), month: value };
}

/**
 * Whether a month's figures are final.
 *
 * A card charge posts days after the purchase, so the total for the month you
 * are standing in keeps moving under you; only once the next month has begun
 * is the number you fetched the number that stays. A month saved while it was
 * still running is worth refetching later. One saved after it closed is not,
 * which is what makes repeating a backfill cheap.
 */
export function isMonthConfirmed(month: string, now: Date): boolean {
  const { year, month: index } = parseMonthKey(month);
  const monthAfter = new Date(year, index, 1, 0, 0, 0, 0);
  return now.getTime() >= monthAfter.getTime();
}

/** Every month from start to end, inclusive, oldest first. */
export function monthsBetween(start: string, end: string): string[] {
  const from = parseMonthKey(start);
  const to = parseMonthKey(end);
  if (from.year * 12 + from.month > to.year * 12 + to.month) {
    throw new Error(`${start} is before ${end}: pass the earlier month first.`);
  }

  const months: string[] = [];
  let year = from.year;
  let index = from.month;
  while (year * 12 + index <= to.year * 12 + to.month) {
    months.push(`${year}-${String(index).padStart(2, '0')}`);
    index += 1;
    if (index > 12) {
      index = 1;
      year += 1;
    }
  }
  return months;
}

function sanitizeProviderName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

export function monthCachePath(cacheDir: string, month: string, provider: string): string {
  parseMonthKey(month);
  return path.join(cacheDir, 'months', month, sanitizeProviderName(provider), 'data.json');
}

function isMonthRecord(value: unknown): value is MonthRecord {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1
    && typeof record.provider === 'string'
    && typeof record.month === 'string'
    && typeof record.fetchedAt === 'string'
    && (record.status === 'provisional' || record.status === 'confirmed')
    && Object.prototype.hasOwnProperty.call(record, 'data')
  );
}

export function loadMonth(
  cacheDir: string,
  month: string,
  provider: string,
): MonthRecord | null {
  const file = monthCachePath(cacheDir, month, provider);
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return isMonthRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveMonth(
  cacheDir: string,
  provider: string,
  data: MoneyForwardMonthData,
  now: Date,
): MonthRecord {
  const record: MonthRecord = {
    version: 1,
    provider,
    month: data.month,
    fetchedAt: now.toISOString(),
    // Recorded rather than derived on read: what matters is whether the month
    // had closed when this was fetched, not whether it has closed by now.
    status: isMonthConfirmed(data.month, now) ? 'confirmed' : 'provisional',
    data,
  };

  const file = monthCachePath(cacheDir, data.month, provider);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

/** The cached months for one provider, oldest first, with their status. */
export function listCachedMonths(
  cacheDir: string,
  provider: string,
): Array<{ month: string; status: MonthStatus }> {
  const root = path.join(cacheDir, 'months');

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && MONTH_KEY.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((month) => {
      const loaded = loadMonth(cacheDir, month, provider);
      return loaded ? { month, status: loaded.status } : null;
    })
    .filter((row): row is { month: string; status: MonthStatus } => row !== null);
}
