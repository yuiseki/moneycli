import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';
import { getCachePath, loadCache, saveCache } from '../src/storage';
import { type MoneySnapshot } from '../src/types';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneycli-test-'));
  tempRoots.push(root);
  return root;
}

function sampleSnapshot(dateKey: string): MoneySnapshot {
  return {
    version: 1,
    provider: 'money_forward',
    dateKey,
    fetchedAt: '2026-02-21T00:00:00.000Z',
    data: {
      kind: 'money_forward',
      targetDate: dateKey,
    },
  };
}

test('getCachePath follows YYYY/MM/DD/provider/data.json layout', () => {
  const cachePath = getCachePath('/tmp/moneycli', '2026-02-21', 'money_forward');
  expect(cachePath).toBe('/tmp/moneycli/2026/02/21/money_forward/data.json');
});

test('saveCache and loadCache round-trip snapshot', () => {
  const root = createTempRoot();
  const snapshot = sampleSnapshot('2026-02-21');

  saveCache(root, snapshot.dateKey, snapshot.provider, snapshot);

  const loaded = loadCache(root, snapshot.dateKey, snapshot.provider);
  expect(loaded).toEqual(snapshot);
});

test('loadCache returns null for malformed payload', () => {
  const root = createTempRoot();
  const filePath = getCachePath(root, '2026-02-21', 'money_forward');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '{"invalid":true}', 'utf8');

  expect(loadCache(root, '2026-02-21', 'money_forward')).toBeNull();
});
