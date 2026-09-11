/**
 * The month-keyed cash-flow cache, and the one rule that makes it useful:
 * a month is not final until the following month has begun.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  isMonthConfirmed,
  listCachedMonths,
  loadMonth,
  monthsBetween,
  saveMonth,
} from '../src/services/months';

let cacheDir = '';

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneycli-months-'));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

function record(month: string) {
  return {
    kind: 'money_forward_month' as const,
    month,
    range: { from: `${month}-01`, to: `${month}-28` },
    totals: {
      month,
      totalIncome: 100,
      totalExpense: 40,
      balance: 60,
      transactionCount: 2,
    },
    transactions: [],
    warnings: [],
  };
}

/**
 * A card charge posts days after the purchase, so the figure for the month
 * you are standing in keeps moving. Only once the next month has started is
 * what you fetched the number that stays.
 */
test('a month is provisional until the following month has begun', () => {
  expect(isMonthConfirmed('2026-03', new Date(2026, 2, 31, 23, 59))).toBe(false);
  expect(isMonthConfirmed('2026-03', new Date(2026, 3, 1, 0, 0))).toBe(true);
  expect(isMonthConfirmed('2026-03', new Date(2026, 8, 11))).toBe(true);
  expect(isMonthConfirmed('2026-09', new Date(2026, 8, 11))).toBe(false);
  // A month that has not happened yet is certainly not confirmed.
  expect(isMonthConfirmed('2027-01', new Date(2026, 8, 11))).toBe(false);
});

test('a saved month comes back with the status it was saved under', () => {
  saveMonth(cacheDir, 'money_forward', record('2026-03'), new Date(2026, 8, 11));
  saveMonth(cacheDir, 'money_forward', record('2026-09'), new Date(2026, 8, 11));

  expect(loadMonth(cacheDir, '2026-03', 'money_forward')?.status).toBe('confirmed');
  expect(loadMonth(cacheDir, '2026-09', 'money_forward')?.status).toBe('provisional');
  expect(loadMonth(cacheDir, '2026-01', 'money_forward')).toBeNull();
});

test('the cached months are listed oldest first, with their status', () => {
  saveMonth(cacheDir, 'money_forward', record('2026-09'), new Date(2026, 8, 11));
  saveMonth(cacheDir, 'money_forward', record('2026-03'), new Date(2026, 8, 11));

  expect(listCachedMonths(cacheDir, 'money_forward')).toEqual([
    { month: '2026-03', status: 'confirmed' },
    { month: '2026-09', status: 'provisional' },
  ]);
});

test('months are kept apart per provider', () => {
  saveMonth(cacheDir, 'money_forward', record('2026-03'), new Date(2026, 8, 11));
  saveMonth(cacheDir, 'other_bank', record('2026-04'), new Date(2026, 8, 11));

  expect(listCachedMonths(cacheDir, 'money_forward').map((row) => row.month)).toEqual(['2026-03']);
  expect(listCachedMonths(cacheDir, 'other_bank').map((row) => row.month)).toEqual(['2026-04']);
});

test('a cache directory that was never written lists nothing', () => {
  expect(listCachedMonths(path.join(cacheDir, 'nope'), 'money_forward')).toEqual([]);
});

/**
 * A month saved while it was still running has to be refetched later. One
 * saved after it closed never does, which is what makes a backfill cheap to
 * repeat.
 */
test('a provisional month saved earlier is still provisional when read back', () => {
  saveMonth(cacheDir, 'money_forward', record('2026-03'), new Date(2026, 2, 15));

  const loaded = loadMonth(cacheDir, '2026-03', 'money_forward');
  expect(loaded?.status).toBe('provisional');
  expect(loaded?.fetchedAt).toBe(new Date(2026, 2, 15).toISOString());
});

test('a range of months is inclusive at both ends', () => {
  expect(monthsBetween('2026-11', '2027-02')).toEqual([
    '2026-11',
    '2026-12',
    '2027-01',
    '2027-02',
  ]);
  expect(monthsBetween('2026-03', '2026-03')).toEqual(['2026-03']);
  expect(() => monthsBetween('2026-05', '2026-03')).toThrow('before');
});
