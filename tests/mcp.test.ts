/**
 * The MCP server, driven over a pipe with JSON-RPC, against a cache the test
 * writes. Nothing here reaches Money Forward, and the server must not try.
 */
import { expect, test } from 'vitest';
import {
  createTempWorkspace,
  runMcp,
  toolJson,
  toolText,
  writeMonth,
  writeSnapshot,
  type Workspace,
} from './helpers';

function seed(ws: Workspace): void {
  writeSnapshot(ws.cacheDir, '2026-02-24', {
    assets: 3_000_000,
    liabilities: 500_000,
    netWorth: 2_500_000,
  });
  writeSnapshot(ws.cacheDir, '2026-09-11', {
    assets: 3_938_823,
    liabilities: 514_593,
    netWorth: 3_424_230,
    month: '2026-09',
    totalIncome: 300_000,
    totalExpense: 9_763,
    breakdown: [
      { service: 'Sample Bank', category: '預金', subcategory: '普通', amount: 2_000_000, kind: 'asset' },
      { service: 'Sample Card', category: 'カード', subcategory: '未払い', amount: 514_593, kind: 'liability' },
    ],
    transactions: [
      {
        id: '1001',
        date: '2026-09-08',
        content: 'サンプル商店 コーヒー豆',
        amount: -2_883,
        account: 'サンプルカード VISA',
        largeCategory: '食費',
        middleCategory: '食料品',
      },
      {
        id: '1002',
        date: '2026-09-05',
        content: 'キュウヨ サンプル',
        amount: 300_000,
        account: 'サンプル銀行',
        largeCategory: '収入',
        middleCategory: '給与',
        isIncome: true,
      },
      {
        id: '1003',
        date: '2026-09-04',
        content: 'サンプル書店',
        amount: -6_880,
        account: 'サンプルカード VISA',
        largeCategory: '教養・教育',
        middleCategory: '書籍',
      },
      {
        id: '1004',
        date: '2026-09-01',
        content: 'ショウケン (投信積立代金)',
        amount: -50_000,
        isTransfer: true,
      },
    ],
  });
}

test('the server introduces itself and lists read-only tools', async () => {
  const ws = createTempWorkspace();
  const { initialize, tools, stderr } = await runMcp(ws, []);

  expect(initialize.serverInfo.name).toBe('moneycli');
  expect(initialize.serverInfo.version).toBe(require('../package.json').version);
  expect(tools.map((tool: any) => tool.name).sort()).toEqual([
    'money_breakdown',
    'money_cash_flow',
    'money_days',
    'money_history',
    'money_months',
    'money_snapshot',
    'money_transactions',
  ]);
  expect(stderr).toContain('money MCP server ready on stdio.');
});

/**
 * The server exists to read a cache, never to scrape a bank aggregator on a
 * model's initiative. Both hints say so, and a client that trusts them must
 * not be lied to.
 */
test('every tool is marked read-only and closed-world', async () => {
  const ws = createTempWorkspace();
  const { tools } = await runMcp(ws, []);

  for (const tool of tools) {
    expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
  }
});

test('money_days lists the cached days oldest first', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [{ name: 'money_days' }]);

  expect(toolJson(responses[0])).toMatchObject({
    provider: 'money_forward',
    day_count: 2,
    first_day: '2026-02-24',
    latest_day: '2026-09-11',
    days: ['2026-02-24', '2026-09-11'],
  });
});

test('money_snapshot defaults to the most recent cached day', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [{ name: 'money_snapshot' }]);
  const payload = toolJson(responses[0]);

  expect(payload.date).toBe('2026-09-11');
  expect(payload.currency).toBe('JPY');
  expect(payload.totals.netWorth).toBe(3_424_230);
  expect(payload.monthly_cash_flow.totalExpense).toBe(9_763);
  expect(payload.transaction_count).toBe(4);
});

test('money_snapshot reads an older day when asked for one', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_snapshot', arguments: { date: '2026-02-24' } },
  ]);

  expect(toolJson(responses[0]).totals.netWorth).toBe(2_500_000);
});

/**
 * A cache-only server that answered a missing day with an empty report would
 * be indistinguishable from a day on which nothing happened. It has to say
 * the day is absent, and say which days are not.
 */
test('a day that was never synced is an error naming the days that exist', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_snapshot', arguments: { date: '1999-01-01' } },
  ]);

  expect(responses[0].result.isError).toBe(true);
  const text = toolText(responses[0]);
  expect(text).toContain('1999-01-01 was never synced');
  expect(text).toContain('2026-09-11');
});

test('an empty cache says to sync rather than reporting zero money', async () => {
  const ws = createTempWorkspace();
  const { responses } = await runMcp(ws, [{ name: 'money_snapshot' }]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain("Run 'money sync' first.");
});

test('a malformed date is refused without taking the server down', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_snapshot', arguments: { date: 'last tuesday' } },
    { name: 'money_days' },
  ]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain('is not a day');
  // The next call still works: the process survived the bad argument.
  expect(toolJson(responses[1]).day_count).toBe(2);
});

test('money_transactions returns what was bought and what came in', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [{ name: 'money_transactions' }]);
  const payload = toolJson(responses[0]);

  expect(payload.match_count).toBe(4);
  expect(payload.counted_income).toBe(300_000);
  // The transfer is excluded from the counted spending: 2,883 + 6,880.
  expect(payload.counted_expense).toBe(9_763);
  expect(payload.transactions[0].content).toBe('サンプル商店 コーヒー豆');
});

test('money_transactions filters by kind', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_transactions', arguments: { kind: 'income' } },
    { name: 'money_transactions', arguments: { kind: 'expense' } },
    { name: 'money_transactions', arguments: { kind: 'transfer' } },
  ]);

  expect(toolJson(responses[0]).transactions.map((row: any) => row.id)).toEqual(['1002']);
  expect(toolJson(responses[1]).transactions.map((row: any) => row.id)).toEqual(['1001', '1003']);
  expect(toolJson(responses[2]).transactions.map((row: any) => row.id)).toEqual(['1004']);
});

test('money_transactions matches text in the description, category or account', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_transactions', arguments: { query: '書籍' } },
    { name: 'money_transactions', arguments: { query: 'サンプルカード' } },
  ]);

  expect(toolJson(responses[0]).transactions.map((row: any) => row.id)).toEqual(['1003']);
  expect(toolJson(responses[1]).transactions.map((row: any) => row.id)).toEqual(['1001', '1003']);
});

test('money_transactions honours the limit without lying about the count', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_transactions', arguments: { limit: 1 } },
  ]);
  const payload = toolJson(responses[0]);

  expect(payload.transactions).toHaveLength(1);
  expect(payload.match_count).toBe(4);
});

test('a day cached before the rows were recorded reports none rather than failing', async () => {
  const ws = createTempWorkspace();
  writeSnapshot(ws.cacheDir, '2026-03-11', { withoutTransactions: true });
  const { responses } = await runMcp(ws, [{ name: 'money_transactions' }]);

  expect(toolJson(responses[0])).toMatchObject({ date: '2026-03-11', match_count: 0 });
});

test('money_breakdown splits assets from debts', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_breakdown', arguments: { kind: 'asset' } },
    { name: 'money_breakdown', arguments: { kind: 'liability' } },
    { name: 'money_breakdown' },
  ]);

  expect(toolJson(responses[0]).breakdown.map((row: any) => row.service)).toEqual(['Sample Bank']);
  expect(toolJson(responses[1]).breakdown.map((row: any) => row.service)).toEqual(['Sample Card']);
  expect(toolJson(responses[2]).row_count).toBe(2);
});

test('money_history walks the cached days and measures the change', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [{ name: 'money_history' }]);
  const payload = toolJson(responses[0]);

  expect(payload.day_count).toBe(2);
  expect(payload.days.map((row: any) => row.date)).toEqual(['2026-02-24', '2026-09-11']);
  expect(payload.net_worth_change).toBe(3_424_230 - 2_500_000);
});

test('money_history respects a range', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_history', arguments: { from: '2026-06-01' } },
  ]);
  const payload = toolJson(responses[0]);

  expect(payload.days.map((row: any) => row.date)).toEqual(['2026-09-11']);
  // One observation is not a change.
  expect(payload.net_worth_change).toBeNull();
});

test('each tool call is announced on stderr, leaving stdout to the protocol', async () => {
  const ws = createTempWorkspace();
  seed(ws);
  const { stderr } = await runMcp(ws, [{ name: 'money_days' }]);

  expect(stderr).toContain('[money-mcp] money_days ok');
});

function seedMonths(ws: Workspace): void {
  writeMonth(ws.cacheDir, {
    month: '2026-03',
    status: 'confirmed',
    totalIncome: 450_116,
    totalExpense: 631_276,
    transactions: [
      {
        id: 'm1',
        date: '2026-03-20',
        content: '振込 サンプル給与',
        amount: 450_116,
        account: 'サンプル銀行',
        largeCategory: '収入',
        middleCategory: '給与',
        isIncome: true,
      },
      {
        id: 'm2',
        date: '2026-03-04',
        content: 'サンプル書店',
        amount: -6_880,
        account: 'サンプルカード VISA',
        largeCategory: '教養・教育',
        middleCategory: '書籍',
      },
    ],
  });
  writeMonth(ws.cacheDir, {
    month: '2026-09',
    status: 'provisional',
    totalIncome: 0,
    totalExpense: 70_669,
  });
}

test('money_months reports each month with whether it is final', async () => {
  const ws = createTempWorkspace();
  seedMonths(ws);
  const { responses } = await runMcp(ws, [{ name: 'money_months' }]);

  expect(toolJson(responses[0])).toMatchObject({
    month_count: 2,
    first_month: '2026-03',
    latest_month: '2026-09',
    months: [
      { month: '2026-03', status: 'confirmed' },
      { month: '2026-09', status: 'provisional' },
    ],
  });
});

test('money_cash_flow returns a whole month, defaulting to the latest', async () => {
  const ws = createTempWorkspace();
  seedMonths(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_cash_flow' },
    { name: 'money_cash_flow', arguments: { month: '2026-03' } },
  ]);

  expect(toolJson(responses[0]).month).toBe('2026-09');
  const march = toolJson(responses[1]);
  expect(march.totals.totalIncome).toBe(450_116);
  expect(march.totals.totalExpense).toBe(631_276);
  expect(march.status).toBe('confirmed');
  expect(march.match_count).toBe(2);
});

test('money_cash_flow filters a month by kind and by text', async () => {
  const ws = createTempWorkspace();
  seedMonths(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_cash_flow', arguments: { month: '2026-03', kind: 'income' } },
    { name: 'money_cash_flow', arguments: { month: '2026-03', query: '書籍' } },
    { name: 'money_cash_flow', arguments: { month: '2026-03', limit: 0 } },
  ]);

  expect(toolJson(responses[0]).transactions.map((row: any) => row.id)).toEqual(['m1']);
  expect(toolJson(responses[1]).transactions.map((row: any) => row.id)).toEqual(['m2']);
  // limit 0 is the totals without the rows, which is the cheap way to ask.
  const totalsOnly = toolJson(responses[2]);
  expect(totalsOnly.transactions).toEqual([]);
  expect(totalsOnly.match_count).toBe(2);
});

/**
 * The stored status was true when it was written. A month fetched while it
 * was running and read back after it closed is stale, and quoting it as the
 * month's spending would understate it.
 */
test('a provisional month whose month has closed says it is not final', async () => {
  const ws = createTempWorkspace();
  writeMonth(ws.cacheDir, {
    month: '2026-01',
    status: 'provisional',
    fetchedAt: '2026-01-15T00:00:00.000Z',
    totalExpense: 1_000,
  });
  const { responses } = await runMcp(ws, [{ name: 'money_cash_flow', arguments: { month: '2026-01' } }]);
  const payload = toolJson(responses[0]);

  expect(payload.status).toBe('provisional');
  expect(payload.note).toContain('not the final figures');
  expect(payload.note).toContain('2026-01');
});

test('a month that was never synced is an error naming the months that were', async () => {
  const ws = createTempWorkspace();
  seedMonths(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_cash_flow', arguments: { month: '2020-01' } },
  ]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain('2020-01 was never synced');
  expect(toolText(responses[0])).toContain('2026-03');
});

test('an empty month cache says to sync rather than reporting no spending', async () => {
  const ws = createTempWorkspace();
  const { responses } = await runMcp(ws, [{ name: 'money_cash_flow' }]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain("Run 'money cf --sync' first.");
});

test('a malformed month is refused', async () => {
  const ws = createTempWorkspace();
  seedMonths(ws);
  const { responses } = await runMcp(ws, [
    { name: 'money_cash_flow', arguments: { month: '2026-13' } },
  ]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain('is not a month');
});
