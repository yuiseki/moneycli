/**
 * Shared scaffolding for the tests that spawn the CLI.
 *
 * Every run gets a temporary cache directory, so nothing here reads or writes
 * the real ~/.cache/moneycli, and nothing reaches Money Forward.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

export const REPO_ROOT = process.cwd();
// The published entry point, not dist/index.js: the wrapper is what users run,
// and it is where the Node version check lives.
export const CLI_PATH = path.join(REPO_ROOT, 'bin', 'money.js');

export type Workspace = {
  rootDir: string;
  cacheDir: string;
};

export function createTempWorkspace(): Workspace {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneycli-test-'));
  const cacheDir = path.join(rootDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  return { rootDir, cacheDir };
}

export type TransactionFixture = {
  id: string;
  date: string;
  content: string;
  amount: number;
  account?: string | null;
  largeCategory?: string | null;
  middleCategory?: string | null;
  isIncome?: boolean;
  isTransfer?: boolean;
  countedInTotals?: boolean;
};

export type SnapshotFixture = {
  assets?: number;
  liabilities?: number;
  netWorth?: number;
  month?: string;
  totalIncome?: number;
  totalExpense?: number;
  transactions?: TransactionFixture[];
  breakdown?: Array<Record<string, unknown>>;
  warnings?: string[];
  /** Omit the transaction field entirely, as a cache written before it existed. */
  withoutTransactions?: boolean;
};

/** Writes one day into the cache, in the layout the CLI reads. */
export function writeSnapshot(
  cacheDir: string,
  dateKey: string,
  fixture: SnapshotFixture = {},
  provider = 'money_forward',
): void {
  const [year, month, day] = dateKey.split('-');
  const dir = path.join(cacheDir, year, month, day, provider);
  fs.mkdirSync(dir, { recursive: true });

  const transactions = (fixture.transactions ?? []).map((entry) => ({
    id: entry.id,
    date: entry.date,
    content: entry.content,
    amount: entry.amount,
    account: entry.account ?? null,
    largeCategory: entry.largeCategory ?? null,
    middleCategory: entry.middleCategory ?? null,
    isIncome: entry.isIncome ?? false,
    isTransfer: entry.isTransfer ?? false,
    countedInTotals: entry.countedInTotals ?? !entry.isTransfer,
  }));

  const data: Record<string, unknown> = {
    kind: 'money_forward',
    source: { type: 'money_forward_web' },
    targetDate: dateKey,
    groups: [],
    totals: {
      assets: fixture.assets ?? 1_000_000,
      liabilities: fixture.liabilities ?? 0,
      netWorth: fixture.netWorth ?? fixture.assets ?? 1_000_000,
      asOfDate: dateKey,
      refreshCompleted: null,
    },
    monthlyCashFlow: {
      month: fixture.month ?? dateKey.slice(0, 7),
      totalIncome: fixture.totalIncome ?? 0,
      totalExpense: fixture.totalExpense ?? 0,
      balance: (fixture.totalIncome ?? 0) - (fixture.totalExpense ?? 0),
      transactionCount: transactions.length,
    },
    accountStatuses: { total: 1, ok: 1, error: 0, updating: 0, unknown: 0 },
    breakdown: fixture.breakdown ?? [],
    warnings: fixture.warnings ?? [],
  };
  if (!fixture.withoutTransactions) {
    data.cashFlowTransactions = transactions;
  }

  fs.writeFileSync(
    path.join(dir, 'data.json'),
    JSON.stringify(
      {
        version: 1,
        provider,
        dateKey,
        fetchedAt: `${dateKey}T00:00:00.000Z`,
        data,
      },
      null,
      2,
    ),
    'utf8',
  );
}

export function runCli(
  workspace: Workspace,
  args: string[],
  env: Record<string, string> = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...(process.env as Record<string, string>),
      MONEYCLI_CACHE_DIR: workspace.cacheDir,
      ...env,
    },
  });
}

export type McpToolCall = { name: string; arguments?: Record<string, unknown> };

export type McpResponse = {
  id: number;
  result?: any;
  error?: { code: number; message: string };
};

/**
 * Speaks JSON-RPC to `money --mcp-server` over a pipe, so the tests cover the
 * framing as well as the tools. One process per call batch: the server holds
 * no state between calls, and a batch is cheaper than keeping one alive.
 */
export async function runMcp(
  workspace: Workspace,
  calls: McpToolCall[],
  env: Record<string, string> = {},
): Promise<{ initialize: any; tools: any[]; responses: McpResponse[]; stderr: string }> {
  const requests: string[] = [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'moneycli-test', version: '0' },
      },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ];
  calls.forEach((call, index) => {
    requests.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3 + index,
        method: 'tools/call',
        params: { name: call.name, arguments: call.arguments ?? {} },
      }),
    );
  });

  const result = spawnSync(process.execPath, [CLI_PATH, '--mcp-server'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...(process.env as Record<string, string>),
      MONEYCLI_CACHE_DIR: workspace.cacheDir,
      ...env,
    },
    input: `${requests.join('\n')}\n`,
    timeout: 60_000,
  });

  const messages: McpResponse[] = result.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

  return {
    initialize: messages.find((message) => message.id === 1)?.result,
    tools: messages.find((message) => message.id === 2)?.result?.tools ?? [],
    responses: messages.filter((message) => message.id >= 3),
    stderr: result.stderr,
  };
}

/** The first text block of a tool result, parsed as JSON. */
export function toolJson(response: McpResponse): any {
  return JSON.parse(response.result.content[0].text);
}

export function toolText(response: McpResponse): string {
  return response.result.content[0].text;
}
