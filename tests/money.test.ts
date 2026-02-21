import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test } from 'vitest';
import { loadMoney } from '../src/money';
import { type MoneyProvider } from '../src/providers/types';
import { saveCache } from '../src/storage';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moneycli-load-test-'));
  tempRoots.push(root);
  return root;
}

test('loadMoney fetches and caches when today cache is missing', async () => {
  const cacheDir = createTempRoot();
  let callCount = 0;

  const provider: MoneyProvider = {
    name: 'stub',
    description: 'stub provider',
    async fetch() {
      callCount += 1;
      return { ok: true };
    },
  };

  const loaded = await loadMoney({
    provider,
    dateKey: '2026-02-21',
    cacheDir,
    now: new Date(2026, 1, 21),
  });

  expect(loaded.fromCache).toBe(false);
  expect(callCount).toBe(1);

  const loadedAgain = await loadMoney({
    provider,
    dateKey: '2026-02-21',
    cacheDir,
    now: new Date(2026, 1, 21),
  });

  expect(loadedAgain.fromCache).toBe(true);
  expect(callCount).toBe(1);
});

test('loadMoney rejects past date without cache when sync is false', async () => {
  const cacheDir = createTempRoot();

  const provider: MoneyProvider = {
    name: 'stub',
    description: 'stub provider',
    async fetch() {
      return { ok: true };
    },
  };

  await expect(
    loadMoney({
      provider,
      dateKey: '2026-02-20',
      cacheDir,
      now: new Date(2026, 1, 21),
    }),
  ).rejects.toThrow('No cache snapshot for 2026-02-20 (stub).');
});

test('loadMoney fetches past date when sync is true', async () => {
  const cacheDir = createTempRoot();
  let callCount = 0;

  const provider: MoneyProvider = {
    name: 'stub',
    description: 'stub provider',
    async fetch() {
      callCount += 1;
      return { ok: true };
    },
  };

  const loaded = await loadMoney({
    provider,
    dateKey: '2026-02-20',
    cacheDir,
    now: new Date(2026, 1, 21),
    forceSync: true,
  });

  expect(loaded.fromCache).toBe(false);
  expect(callCount).toBe(1);
});

test('loadMoney ignores incompatible legacy cache for money_forward on today', async () => {
  const cacheDir = createTempRoot();
  const dateKey = '2026-02-21';
  let callCount = 0;

  saveCache(cacheDir, dateKey, 'money_forward', {
    version: 1,
    provider: 'money_forward',
    dateKey,
    fetchedAt: '2026-02-21T00:00:00.000Z',
    data: {
      kind: 'money_forward',
      source: {
        type: 'mf-dashboard-sqlite',
        dbPath: '/tmp/demo.db',
      },
    },
  });

  const provider: MoneyProvider = {
    name: 'money_forward',
    description: 'money forward',
    async fetch() {
      callCount += 1;
      return {
        kind: 'money_forward',
        source: {
          type: 'money_forward_web',
          cookiePath: '/tmp/cookies.json',
          urls: {},
        },
        groups: [],
      };
    },
  };

  const loaded = await loadMoney({
    provider,
    dateKey,
    cacheDir,
    now: new Date(2026, 1, 21),
  });

  expect(loaded.fromCache).toBe(false);
  expect(callCount).toBe(1);
});
