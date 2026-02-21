import { expect, test } from 'vitest';
import { formatMoneyReport } from '../src/format';
import { type LoadedMoney } from '../src/types';

test('formatMoneyReport supports legacy money_forward cache payloads', () => {
  const loaded: LoadedMoney = {
    fromCache: true,
    dateKey: '2026-02-21',
    provider: 'money_forward',
    snapshot: {
      version: 1,
      provider: 'money_forward',
      dateKey: '2026-02-21',
      fetchedAt: '2026-02-21T01:04:25.954Z',
      data: {
        kind: 'money_forward',
        source: {
          type: 'mf-dashboard-sqlite',
          dbPath: '/tmp/demo.db',
        },
        targetDate: '2026-02-21',
        capturedAt: '2026-02-21T01:04:25.954Z',
        groups: [
          {
            id: '0',
            name: 'Default',
            isCurrent: true,
            lastScrapedAt: null,
            latestAssetHistory: {
              date: '2026-02-21',
              totalAssets: 1000,
              change: 20,
              categories: [],
            },
          },
        ],
        totals: {
          assets: 1000,
          liabilities: 500,
          netWorth: 500,
          asOfDate: '2026-02-21',
          refreshCompleted: null,
        },
        monthlyCashFlow: {
          month: '2026-02',
          totalIncome: 100,
          totalExpense: 70,
          balance: 30,
          transactionCount: 10,
        },
        accountStatuses: {
          total: 2,
          ok: 1,
          error: 0,
          updating: 1,
          unknown: 0,
        },
      },
    },
  };

  const output = formatMoneyReport(loaded, { locale: 'en' });
  expect(output).not.toContain('money (');
  expect(output).not.toContain('Provider:');
  expect(output).not.toContain('Source type:');
  expect(output).not.toContain('Cookie file:');
  expect(output).toContain('Source DB: /tmp/demo.db');
  expect(output).toContain('Assets: 1,000 JPY');
  expect(output).toContain('Liabilities: 500 JPY');
  expect(output).not.toContain('History URL:');
  expect(output).not.toContain('Cash flow URL:');
});
