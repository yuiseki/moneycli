/**
 * A Model Context Protocol server over stdio, started with `money --mcp-server`.
 *
 * It is the CLI itself rather than a second program, so it reads the same
 * cache and the same configuration as every other `money` command.
 *
 * It never fetches. Money Forward is reached only with the user's live
 * session cookies, and a tool that scraped a bank aggregator whenever a model
 * thought it should is not a thing to hand a model. Syncing stays a
 * deliberate act: `money sync`, or whatever cron the user set up. Every tool
 * here is therefore read-only and closed-world, and a day that was never
 * synced is reported as missing rather than fetched on the spot.
 *
 * stdout belongs to the protocol. Everything this file has to say to a human
 * goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { config } from './config';
import { parseDateKey } from './date';
import {
  latestCachedDay,
  listCachedDays,
  loadSnapshot,
} from './services/snapshots';
import { type MoneySnapshot } from './types';

function serverVersion(): string {
  // The published tarball always contains package.json, and dist/ sits one
  // level below it, so this holds both in the repository and once installed.
  return require('../package.json').version as string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function asJsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Every tool call is announced on stderr, with what it was asked and how long
 * it took. stdout is the protocol, and a server that says nothing at all is
 * indistinguishable from one that has hung. The shape matches hatebucli's and
 * gyazocli's, so one grep reads all three.
 */
function logged<Args, Result>(
  name: string,
  handler: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  return async (args: Args) => {
    const startedAt = Date.now();
    const given = Object.entries((args || {}) as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== false)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' ');
    try {
      const result = await handler(args);
      console.error(`[money-mcp] ${name} ok ${Date.now() - startedAt}ms ${given}`.trimEnd());
      return result;
    } catch (error: any) {
      console.error(
        `[money-mcp] ${name} failed ${Date.now() - startedAt}ms ${given}`.trimEnd(),
        `- ${error?.message || error}`,
      );
      throw error;
    }
  };
}

/**
 * A tool must answer a bad argument, not take the process down, so the date
 * is validated here rather than through the CLI's exiting parser.
 */
function validDateKey(value: string): string {
  try {
    parseDateKey(value);
  } catch {
    throw new Error(`'${value}' is not a day. Pass a date as yyyy-mm-dd.`);
  }
  return value;
}

const providerName = () => config.MONEYCLI_PROVIDER;
const cacheDir = () => config.MONEYCLI_CACHE_DIR;

/**
 * The snapshot for a day, or for the newest cached day when none is given.
 *
 * Nothing is fetched, so a missing day is an error that names the days that
 * do exist: a client that guessed a date can correct itself in one step
 * instead of concluding the archive is empty.
 */
function requireSnapshot(date: string | undefined): { dateKey: string; snapshot: MoneySnapshot } {
  const provider = providerName();
  const root = cacheDir();

  const dateKey = date === undefined ? latestCachedDay(root, provider) : validDateKey(date);
  if (dateKey === null) {
    throw new Error(
      `No day has been synced for ${provider} yet. Run 'money sync' first.`,
    );
  }

  const snapshot = loadSnapshot(root, dateKey, provider);
  if (!snapshot) {
    const days = listCachedDays(root, provider);
    const nearby = days.slice(-5).join(', ');
    throw new Error(
      `${dateKey} was never synced for ${provider}.`
      + (days.length > 0
        ? ` ${days.length} day(s) are cached; the most recent are: ${nearby}.`
        : ' Nothing is cached yet.'),
    );
  }

  return { dateKey, snapshot };
}

type Transaction = {
  id: string | null;
  date: string | null;
  content: string | null;
  amount: number;
  account: string | null;
  largeCategory: string | null;
  middleCategory: string | null;
  isIncome: boolean;
  isTransfer: boolean;
  countedInTotals: boolean;
};

function readTransactions(snapshot: MoneySnapshot): Transaction[] {
  const data = isRecord(snapshot.data) ? snapshot.data : null;
  const rows = data?.cashFlowTransactions;
  if (!Array.isArray(rows)) return [];

  return rows.filter(isRecord).map((row) => ({
    id: typeof row.id === 'string' ? row.id : null,
    date: typeof row.date === 'string' ? row.date : null,
    content: typeof row.content === 'string' ? row.content : null,
    amount: typeof row.amount === 'number' ? row.amount : 0,
    account: typeof row.account === 'string' ? row.account : null,
    largeCategory: typeof row.largeCategory === 'string' ? row.largeCategory : null,
    middleCategory: typeof row.middleCategory === 'string' ? row.middleCategory : null,
    isIncome: row.isIncome === true,
    isTransfer: row.isTransfer === true,
    countedInTotals: row.countedInTotals === true,
  }));
}

function snapshotField(snapshot: MoneySnapshot, key: string): unknown {
  const data = isRecord(snapshot.data) ? snapshot.data : null;
  return data ? data[key] : undefined;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'moneycli', version: serverVersion() });

  server.registerTool(
    'money_days',
    {
      title: 'Which days are in the cache',
      description:
        'The days the household finances were synced on, oldest first. Nothing here '
        + 'is fetched on demand, so this is the full list of days any other tool can '
        + 'answer about. Ask this first when a question is about a date rather than '
        + 'about right now.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('money_days', async () => {
      const provider = providerName();
      const days = listCachedDays(cacheDir(), provider);
      return asJsonResult({
        provider,
        day_count: days.length,
        first_day: days[0] ?? null,
        latest_day: days[days.length - 1] ?? null,
        days,
      });
    }),
  );

  server.registerTool(
    'money_snapshot',
    {
      title: 'The household finances on one day',
      description:
        'Assets, liabilities and net worth as of one day, with that month\'s income '
        + 'and spending totals and whether every account was updating cleanly. Omit '
        + 'the date for the most recent day that was synced. Amounts are Japanese yen.',
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe('The day, as yyyy-mm-dd. Omit for the most recent cached day'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('money_snapshot', async ({ date }) => {
      const { dateKey, snapshot } = requireSnapshot(date);
      const transactions = readTransactions(snapshot);

      return asJsonResult({
        date: dateKey,
        provider: snapshot.provider,
        fetched_at: snapshot.fetchedAt,
        currency: 'JPY',
        totals: snapshotField(snapshot, 'totals') ?? null,
        monthly_cash_flow: snapshotField(snapshot, 'monthlyCashFlow') ?? null,
        account_statuses: snapshotField(snapshot, 'accountStatuses') ?? null,
        transaction_count: transactions.length,
        warnings: snapshotField(snapshot, 'warnings') ?? [],
      });
    }),
  );

  server.registerTool(
    'money_transactions',
    {
      title: 'What was bought, and what came in',
      description:
        'The individual entries behind a month\'s totals: the day, what it was, how '
        + 'much, which category and which card or account. This is the tool for what '
        + 'the money actually went on. Transfers between the user\'s own accounts are '
        + 'included but marked, and Money Forward leaves them out of the monthly '
        + 'totals, so do not add them to spending. Older cached days may predate this '
        + 'being recorded and legitimately have no entries.',
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe('The cached day to read, as yyyy-mm-dd. Omit for the most recent'),
        kind: z
          .enum(['all', 'income', 'expense', 'transfer'])
          .default('all')
          .describe('Which entries to return'),
        query: z
          .string()
          .optional()
          .describe('Only entries whose description, category or account contains this text'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(100)
          .describe('Most entries to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('money_transactions', async ({ date, kind, query, limit }) => {
      const { dateKey, snapshot } = requireSnapshot(date);
      const all = readTransactions(snapshot);

      const byKind = all.filter((entry) => {
        if (kind === 'all') return true;
        if (kind === 'transfer') return entry.isTransfer;
        if (entry.isTransfer) return false;
        return kind === 'income' ? entry.isIncome : !entry.isIncome;
      });

      const needle = query?.trim().toLowerCase();
      const matched = needle
        ? byKind.filter((entry) =>
            [entry.content, entry.largeCategory, entry.middleCategory, entry.account]
              .filter((part): part is string => Boolean(part))
              .some((part) => part.toLowerCase().includes(needle)),
          )
        : byKind;

      // Only what Money Forward itself counts, so these add up to the totals
      // in money_snapshot rather than to something slightly larger.
      const counted = matched.filter((entry) => entry.countedInTotals);

      return asJsonResult({
        date: dateKey,
        month: (snapshotField(snapshot, 'monthlyCashFlow') as any)?.month ?? null,
        kind,
        ...(needle ? { query: query?.trim() } : {}),
        currency: 'JPY',
        match_count: matched.length,
        counted_income: counted
          .filter((entry) => entry.isIncome)
          .reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
        counted_expense: counted
          .filter((entry) => !entry.isIncome)
          .reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
        transactions: matched.slice(0, limit),
      });
    }),
  );

  server.registerTool(
    'money_breakdown',
    {
      title: 'Where the assets and the debts sit',
      description:
        'The balance of every account, card and holding on one day, by financial '
        + 'institution and category. This is the tool for which bank or which card a '
        + 'balance is in, as opposed to the single totals in money_snapshot.',
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe('The cached day to read, as yyyy-mm-dd. Omit for the most recent'),
        kind: z
          .enum(['all', 'asset', 'liability'])
          .default('all')
          .describe('Assets, debts, or both'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('money_breakdown', async ({ date, kind }) => {
      const { dateKey, snapshot } = requireSnapshot(date);
      const rows = snapshotField(snapshot, 'breakdown');
      const breakdown = Array.isArray(rows) ? rows.filter(isRecord) : [];
      const matched = breakdown.filter((row) => kind === 'all' || row.kind === kind);

      return asJsonResult({
        date: dateKey,
        kind,
        currency: 'JPY',
        row_count: matched.length,
        totals: snapshotField(snapshot, 'totals') ?? null,
        breakdown: matched,
      });
    }),
  );

  server.registerTool(
    'money_history',
    {
      title: 'How the totals moved over the cached days',
      description:
        'Assets, liabilities and net worth for every cached day in a range, oldest '
        + 'first, with the change from the first day to the last. The days are only '
        + 'the ones that were synced, which is usually not every calendar day, so read '
        + 'this as a series of observations rather than a daily series.',
      inputSchema: {
        from: z.string().optional().describe('Earliest day to include, as yyyy-mm-dd'),
        to: z.string().optional().describe('Latest day to include, as yyyy-mm-dd'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(120)
          .describe('Most days to return, counting back from the latest'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('money_history', async ({ from, to, limit }) => {
      const provider = providerName();
      const root = cacheDir();
      const lower = from === undefined ? undefined : validDateKey(from);
      const upper = to === undefined ? undefined : validDateKey(to);

      const days = listCachedDays(root, provider).filter((day) => {
        if (lower !== undefined && day < lower) return false;
        if (upper !== undefined && day > upper) return false;
        return true;
      });

      const rows = days
        .slice(-limit)
        .map((day) => {
          const snapshot = loadSnapshot(root, day, provider);
          if (!snapshot) return null;
          const totals = snapshotField(snapshot, 'totals');
          const numbers = isRecord(totals) ? totals : {};
          return {
            date: day,
            assets: typeof numbers.assets === 'number' ? numbers.assets : null,
            liabilities: typeof numbers.liabilities === 'number' ? numbers.liabilities : null,
            net_worth: typeof numbers.netWorth === 'number' ? numbers.netWorth : null,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      const withNetWorth = rows.filter((row) => row.net_worth !== null);
      const first = withNetWorth[0];
      const last = withNetWorth[withNetWorth.length - 1];

      return asJsonResult({
        provider,
        currency: 'JPY',
        day_count: rows.length,
        first_day: rows[0]?.date ?? null,
        latest_day: rows[rows.length - 1]?.date ?? null,
        net_worth_change:
          first && last && first !== last ? (last.net_worth as number) - (first.net_worth as number) : null,
        days: rows,
      });
    }),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(
    `money MCP server ready on stdio. Cache: ${cacheDir()} (provider: ${providerName()}).`,
  );
}
