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

/** A snapshot with the fields formatMoneyReport needs, plus whatever a test adds. */
function snapshotWith(data: Record<string, unknown>): LoadedMoney {
  return {
    fromCache: true,
    dateKey: '2026-09-11',
    provider: 'money_forward',
    snapshot: {
      version: 1,
      provider: 'money_forward',
      dateKey: '2026-09-11',
      fetchedAt: '2026-09-11T04:00:00.000Z',
      data: {
        kind: 'money_forward',
        source: { type: 'money_forward_web' },
        groups: [],
        totals: { assets: 1000, liabilities: 0, netWorth: 1000, asOfDate: '2026-09-11' },
        monthlyCashFlow: {
          month: '2026-09',
          totalIncome: 300000,
          totalExpense: 2883,
          balance: 297117,
          transactionCount: 3,
        },
        ...data,
      },
    },
  };
}

const TRANSACTIONS = [
  {
    id: '1001',
    date: '2026-09-08',
    content: 'VISA海外利用 SOME SHOP',
    amount: -2883,
    account: 'サンプルカード VISA',
    largeCategory: '食費',
    middleCategory: '食費',
    isIncome: false,
    isTransfer: false,
    countedInTotals: true,
  },
  {
    id: '1002',
    date: '2026-09-05',
    content: 'キュウヨ サンプル',
    amount: 300000,
    account: 'サンプル銀行',
    largeCategory: '収入',
    middleCategory: '給与',
    isIncome: true,
    isTransfer: false,
    countedInTotals: true,
  },
  {
    id: '1003',
    date: '2026-09-01',
    content: 'ショウケン (投信積立代金)',
    amount: -50000,
    account: null,
    largeCategory: null,
    middleCategory: null,
    isIncome: false,
    isTransfer: true,
    countedInTotals: false,
  },
];

test('the report lists what was bought and what came in', () => {
  const output = formatMoneyReport(snapshotWith({ cashFlowTransactions: TRANSACTIONS }), {
    locale: 'en',
  });

  expect(output).toContain('Income');
  expect(output).toContain('09/05  キュウヨ サンプル');
  expect(output).toContain('300,000 JPY');
  expect(output).toContain('Expense');
  expect(output).toContain('09/08  VISA海外利用 SOME SHOP');
  expect(output).toContain('-2,883 JPY');
  // The category and the account say which pocket it came out of.
  expect(output).toContain('食費 / 食費');
  expect(output).toContain('サンプルカード VISA');
});

test('a transfer is shown apart, and marked as outside the totals', () => {
  const output = formatMoneyReport(snapshotWith({ cashFlowTransactions: TRANSACTIONS }), {
    locale: 'en',
  });

  expect(output).toContain('Transfers (not counted)');
  expect(output).toContain('ショウケン (投信積立代金)');

  // It must not be filed under spending: that would overstate the month.
  const expenseSection = output.slice(
    output.indexOf('Expense\n'),
    output.indexOf('Transfers (not counted)'),
  );
  expect(expenseSection).not.toContain('ショウケン');
});

test('an older cache without the rows simply has no transaction list', () => {
  const output = formatMoneyReport(snapshotWith({}), { locale: 'en' });

  expect(output).toContain('Monthly cash flow');
  expect(output).not.toContain('Transfers (not counted)');
  expect(output).not.toContain('VISA海外利用');
});

test('the Japanese report labels the same three sections', () => {
  const output = formatMoneyReport(snapshotWith({ cashFlowTransactions: TRANSACTIONS }), {
    locale: 'ja',
  });

  expect(output).toContain('収入');
  expect(output).toContain('支出');
  expect(output).toContain('振替（集計対象外）');
});
