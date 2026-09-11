/**
 * Reading the cache as an archive rather than one day at a time.
 *
 * The MCP server never fetches, so knowing which days exist is the difference
 * between answering a question and guessing a date.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  latestCachedDay,
  listCachedDays,
  loadSnapshot,
} from '../src/services/snapshots';

let cacheDir = '';

function seed(dateKey: string, provider: string, data: unknown): void {
  const [year, month, day] = dateKey.split('-');
  const dir = path.join(cacheDir, year, month, day, provider);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'data.json'),
    JSON.stringify({
      version: 1,
      provider,
      dateKey,
      fetchedAt: `${dateKey}T00:00:00.000Z`,
      data,
    }),
    'utf8',
  );
}

beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneycli-snapshots-'));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('the cached days come back oldest first', () => {
  seed('2026-09-11', 'money_forward', { kind: 'money_forward' });
  seed('2026-02-24', 'money_forward', { kind: 'money_forward' });
  seed('2026-03-11', 'money_forward', { kind: 'money_forward' });

  expect(listCachedDays(cacheDir, 'money_forward')).toEqual([
    '2026-02-24',
    '2026-03-11',
    '2026-09-11',
  ]);
});

test('a day cached for another provider is not counted as this one', () => {
  seed('2026-09-11', 'money_forward', { kind: 'money_forward' });
  seed('2026-09-10', 'other_bank', { kind: 'other' });

  expect(listCachedDays(cacheDir, 'money_forward')).toEqual(['2026-09-11']);
  expect(listCachedDays(cacheDir, 'other_bank')).toEqual(['2026-09-10']);
});

test('a cache directory that does not exist is empty, not an error', () => {
  expect(listCachedDays(path.join(cacheDir, 'nope'), 'money_forward')).toEqual([]);
  expect(latestCachedDay(path.join(cacheDir, 'nope'), 'money_forward')).toBeNull();
});

/** Stray files and half-written directories must not stop the listing. */
test('directories that are not dates are ignored', () => {
  seed('2026-09-11', 'money_forward', { kind: 'money_forward' });
  fs.mkdirSync(path.join(cacheDir, 'tmp', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'notes.txt'), 'hello', 'utf8');

  expect(listCachedDays(cacheDir, 'money_forward')).toEqual(['2026-09-11']);
});

test('the latest day is the newest one cached', () => {
  seed('2026-02-24', 'money_forward', { kind: 'money_forward' });
  seed('2026-09-11', 'money_forward', { kind: 'money_forward' });

  expect(latestCachedDay(cacheDir, 'money_forward')).toBe('2026-09-11');
});

test('a snapshot loads by day, and a missing day is null', () => {
  seed('2026-09-11', 'money_forward', { kind: 'money_forward', totals: { netWorth: 5 } });

  const loaded = loadSnapshot(cacheDir, '2026-09-11', 'money_forward');
  expect(loaded?.dateKey).toBe('2026-09-11');
  expect((loaded?.data as any).totals.netWorth).toBe(5);

  expect(loadSnapshot(cacheDir, '2026-09-10', 'money_forward')).toBeNull();
});
