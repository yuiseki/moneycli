import { type MoneyCliConfig } from '../../config';
import { type MoneyProvider } from '../types';
import { parseJapaneseYen, stripTags } from './html';
import {
  fetchMonthlyCashFlowPage,
  parseCashFlowTransactions,
  parseMonthlyCashFlow,
  type MoneyForwardTransaction,
} from './cash-flow';
import {
  MONEYFORWARD_BASE_URL,
  fetchHtmlWithCookies,
  loadCookieFile,
} from './http';

export interface MoneyForwardAssetHistory {
  date: string;
  totalAssets: number;
  change: number;
  categories: Array<{ name: string; amount: number }>;
}

export interface MoneyForwardGroupSnapshot {
  id: string;
  name: string;
  isCurrent: boolean;
  lastScrapedAt: string | null;
  latestAssetHistory: MoneyForwardAssetHistory | null;
}

export interface MoneyForwardSnapshotData {
  kind: 'money_forward';
  source: {
    type: 'money_forward_web';
    cookiePath: string;
    urls: {
      history: string;
      historyList: string;
      cashFlow: string;
      liability: string;
      accounts: string;
    };
  };
  targetDate: string;
  capturedAt: string;
  groups: MoneyForwardGroupSnapshot[];
  totals: {
    assets: number | null;
    liabilities: number | null;
    netWorth: number | null;
    asOfDate: string | null;
    refreshCompleted: boolean | null;
  };
  monthlyCashFlow: {
    month: string;
    totalIncome: number;
    totalExpense: number;
    balance: number;
    transactionCount: number;
  };
  /** The rows behind monthlyCashFlow: what was bought, and what came in. */
  cashFlowTransactions: MoneyForwardTransaction[];
  accountStatuses: {
    total: number;
    ok: number;
    error: number;
    updating: number;
    unknown: number;
  };
  breakdown: Array<{
    service: string;
    category: string;
    subcategory: string;
    amount: number;
    kind: 'asset' | 'liability';
  }>;
  warnings: string[];
}


function parseGroups(html: string): Array<{ id: string; name: string; isCurrent: boolean }> {
  const selectMatch = html.match(
    /<select[^>]*name="group_id_hash"[^>]*>([\s\S]*?)<\/select>/i,
  );
  if (!selectMatch) return [];

  const optionsHtml = selectMatch[1];
  const groups: Array<{ id: string; name: string; isCurrent: boolean }> = [];
  const optionPattern = /<option([^>]*)value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi;

  for (const match of optionsHtml.matchAll(optionPattern)) {
    const attrs = match[1] || '';
    const id = (match[2] || '').trim();
    const name = stripTags(match[3] || '');

    if (!id || id === 'create_group') continue;

    groups.push({
      id,
      name,
      isCurrent: /selected/i.test(attrs),
    });
  }

  return groups;
}

function extractTableHeaders(html: string): string[] {
  const tableMatch = html.match(
    /<table[^>]*class="table table-bordered"[^>]*>[\s\S]*?<thead>([\s\S]*?)<\/thead>/i,
  );
  if (!tableMatch) return [];

  const headers: string[] = [];
  const thPattern = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  for (const match of tableMatch[1].matchAll(thPattern)) {
    headers.push(stripTags(match[1] || ''));
  }

  return headers;
}

function parseHistorySummaryRow(
  historyHtml: string,
  dateKey: string,
): { totalAssets: number; categories: Array<{ name: string; amount: number }> } | null {
  const headers = extractTableHeaders(historyHtml);
  if (headers.length < 4 || headers[0] !== '日付') return null;

  const escapedDate = dateKey.replace(/[-/]/g, (token) => `\\${token}`);
  const rowPattern = new RegExp(
    `<tr>\\s*<th>\\s*${escapedDate}\\s*<\\/th>([\\s\\S]*?)<\\/tr>`,
    'i',
  );
  const rowMatch = historyHtml.match(rowPattern);
  if (!rowMatch) return null;

  const tdValues: string[] = [];
  const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  for (const tdMatch of rowMatch[1].matchAll(tdPattern)) {
    tdValues.push(tdMatch[1] || '');
  }

  if (tdValues.length < 2) return null;

  const totalAssets = parseJapaneseYen(tdValues[0]);
  const categoryNames = headers.slice(2, -1);
  const categories = categoryNames.map((name, index) => ({
    name,
    amount: parseJapaneseYen(tdValues[index + 1] || '0'),
  }));

  return {
    totalAssets,
    categories,
  };
}

function parseHistoryDetailRows(html: string): Array<{
  service: string;
  category: string;
  subcategory: string;
  amount: number;
  kind: 'asset' | 'liability';
}> {
  const tableMatch = html.match(
    /<table[^>]*id="history-list"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
  );
  if (!tableMatch) return [];

  const rows: Array<{
    service: string;
    category: string;
    subcategory: string;
    amount: number;
    kind: 'asset' | 'liability';
  }> = [];

  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of tableMatch[1].matchAll(rowPattern)) {
    const rowHtml = rowMatch[1] || '';

    const cells: string[] = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    for (const cellMatch of rowHtml.matchAll(cellPattern)) {
      cells.push(cellMatch[1] || '');
    }

    if (cells.length < 3) continue;

    const service = stripTags(cells[0]);
    const categoryLabel = stripTags(cells[1]);

    const amountMatch = cells[2].match(
      /<span[^>]*class="currency"[^>]*>\s*<span>([\s\S]*?)<\/span>/i,
    );
    const rawAmount = amountMatch ? amountMatch[1] : cells[2];
    const amount = parseJapaneseYen(rawAmount);

    const [majorCategoryRaw, subCategoryRaw] = categoryLabel.split('/');
    const category = (majorCategoryRaw || '').trim() || 'unknown';
    const subcategory = (subCategoryRaw || '').trim() || 'unknown';
    const kind: 'asset' | 'liability' = amount < 0 || category.includes('負債')
      ? 'liability'
      : 'asset';

    rows.push({
      service,
      category,
      subcategory,
      amount,
      kind,
    });
  }

  return rows;
}

function parseLiabilityTotal(html: string): number | null {
  const plain = stripTags(html);
  const match = plain.match(/負債総額：\s*([0-9,]+)\s*円/);
  if (!match) return null;
  return parseJapaneseYen(match[1]);
}

function parseAccountStatuses(html: string): {
  total: number;
  ok: number;
  error: number;
  updating: number;
  unknown: number;
} {
  let ok = 0;
  let error = 0;
  let updating = 0;
  let unknown = 0;

  const statusCellPattern = /<td class="([^"]*\baccount-status\b[^"]*)"[^>]*>/gi;
  for (const match of html.matchAll(statusCellPattern)) {
    const className = (match[1] || '').toLowerCase();

    if (className.includes('error')) {
      error += 1;
      continue;
    }
    if (className.includes('updating')) {
      updating += 1;
      continue;
    }
    if (className.includes('normal')) {
      ok += 1;
      continue;
    }

    unknown += 1;
  }

  const total = ok + error + updating + unknown;

  return {
    total,
    ok,
    error,
    updating,
    unknown,
  };
}

function buildMoneyForwardSnapshot(
  config: MoneyCliConfig,
  dateKey: string,
  now: Date,
  pages: {
    history: { html: string; finalUrl: string };
    historyList: { html: string; finalUrl: string };
    cashFlow: { html: string; finalUrl: string };
    liability: { html: string; finalUrl: string };
    accounts: { html: string; finalUrl: string };
  },
): MoneyForwardSnapshotData {
  const warnings: string[] = [];
  const detailRows = parseHistoryDetailRows(pages.historyList.html);

  const assetsFromDetails = detailRows
    .filter((row) => row.kind === 'asset')
    .reduce((sum, row) => sum + row.amount, 0);

  const liabilitiesFromDetails = detailRows
    .filter((row) => row.kind === 'liability')
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);

  const liabilitiesFromSummary = parseLiabilityTotal(pages.liability.html);
  const liabilities = liabilitiesFromDetails > 0
    ? liabilitiesFromDetails
    : liabilitiesFromSummary;

  const assets = assetsFromDetails > 0 ? assetsFromDetails : null;

  if (assets === null) {
    warnings.push('Failed to parse asset totals from history list page.');
  }
  if (liabilities === null) {
    warnings.push('Failed to parse liability totals from liability page.');
  }

  const netWorth =
    typeof assets === 'number' && typeof liabilities === 'number'
      ? assets - liabilities
      : assets;

  const groupOptions = parseGroups(pages.history.html);
  if (groupOptions.length === 0) {
    warnings.push('Group selector was not found.');
  }

  const historySummary = parseHistorySummaryRow(pages.history.html, dateKey);

  const selectedGroup =
    groupOptions.find((group) => group.isCurrent)
    || groupOptions.find((group) => group.id === '0')
    || groupOptions[0];

  const categoryTotalsFromDetails = new Map<string, number>();
  for (const row of detailRows.filter((item) => item.kind === 'asset')) {
    categoryTotalsFromDetails.set(
      row.category,
      (categoryTotalsFromDetails.get(row.category) || 0) + row.amount,
    );
  }

  const detailCategories = Array.from(categoryTotalsFromDetails.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  const selectedGroupHistory: MoneyForwardAssetHistory | null = selectedGroup
    ? {
      date: dateKey,
      totalAssets: historySummary?.totalAssets ?? assetsFromDetails,
      change: 0,
      categories: historySummary?.categories ?? detailCategories,
    }
    : null;

  const groups: MoneyForwardGroupSnapshot[] = groupOptions.map((group) => ({
    id: group.id,
    name: group.name,
    isCurrent: group.isCurrent,
    lastScrapedAt: null,
    latestAssetHistory: selectedGroup && group.id === selectedGroup.id ? selectedGroupHistory : null,
  }));

  const monthKey = dateKey.slice(0, 7);
  const monthlyCashFlow = parseMonthlyCashFlow(pages.cashFlow.html, monthKey);
  const cashFlowTransactions = parseCashFlowTransactions(pages.cashFlow.html);

  // A GET of /cf always answers with the current month, whatever from, to,
  // year and month are set to in the query. Syncing a past day therefore
  // files this month's ledger under that day, and the only honest thing to
  // do is say so rather than let the月 label imply otherwise.
  if (monthlyCashFlow.month !== monthKey) {
    warnings.push(
      `Cash flow is ${monthlyCashFlow.month}, not ${monthKey}: moneyforward.com/cf `
      + 'only serves the current month.',
    );
  }

  return {
    kind: 'money_forward',
    source: {
      type: 'money_forward_web',
      cookiePath: config.MONEYFORWARD_COOKIE_PATH,
      urls: {
        history: pages.history.finalUrl,
        historyList: pages.historyList.finalUrl,
        cashFlow: pages.cashFlow.finalUrl,
        liability: pages.liability.finalUrl,
        accounts: pages.accounts.finalUrl,
      },
    },
    targetDate: dateKey,
    capturedAt: now.toISOString(),
    groups,
    totals: {
      assets,
      liabilities,
      netWorth,
      asOfDate: dateKey,
      refreshCompleted: null,
    },
    monthlyCashFlow,
    cashFlowTransactions,
    accountStatuses: parseAccountStatuses(pages.accounts.html),
    breakdown: detailRows,
    warnings,
  };
}

function buildUrls(dateKey: string): {
  history: string;
  historyList: string;
  cashFlow: string;
  liability: string;
  accounts: string;
} {
  return {
    history: `${MONEYFORWARD_BASE_URL}/bs/history`,
    historyList: `${MONEYFORWARD_BASE_URL}/bs/history/list/${dateKey}`,
    // No query string: /cf ignores from, to, year and month on a GET and
    // answers with the current month regardless, so parameters here only
    // record a range that was never applied.
    cashFlow: `${MONEYFORWARD_BASE_URL}/cf`,
    liability: `${MONEYFORWARD_BASE_URL}/bs/liability`,
    accounts: `${MONEYFORWARD_BASE_URL}/accounts`,
  };
}

export function createMoneyForwardProvider(config: MoneyCliConfig): MoneyProvider {
  return {
    name: 'money_forward',
    description: 'Money Forward data source via authenticated web cookies',
    async fetch(context) {
      const cookies = loadCookieFile(config.MONEYFORWARD_COOKIE_PATH);
      const urls = buildUrls(context.dateKey);

      const [history, historyList, cashFlow, liability, accounts] = await Promise.all([
        fetchHtmlWithCookies(urls.history, cookies, context.now),
        fetchHtmlWithCookies(urls.historyList, cookies, context.now),
        fetchHtmlWithCookies(urls.cashFlow, cookies, context.now),
        fetchHtmlWithCookies(urls.liability, cookies, context.now),
        fetchHtmlWithCookies(urls.accounts, cookies, context.now),
      ]);

      return buildMoneyForwardSnapshot(config, context.dateKey, context.now, {
        history,
        historyList,
        cashFlow,
        liability,
        accounts,
      });
    },

    async fetchMonth(context) {
      return fetchMonthlyCashFlowPage(config, context.monthKey, context.now);
    },
  };
}
