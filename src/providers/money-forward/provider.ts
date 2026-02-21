import fs from 'fs';
import { type MoneyCliConfig } from '../../config';
import { parseDateKey } from '../../date';
import { type MoneyProvider } from '../types';

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

type BrowserCookie = {
  domain: string;
  hostOnly?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  path?: string;
  expirationDate?: number;
  session?: boolean;
  name: string;
  value: string;
};

const MONEYFORWARD_BASE_URL = 'https://moneyforward.com';

function normalizeWhitespace(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, ' '));
}

function parseJapaneseYen(value: string): number {
  const normalized = stripTags(value)
    .replace(/円/g, '')
    .replace(/,/g, '')
    .replace(/[＋+]/g, '')
    .replace(/[−－]/g, '-');

  const match = normalized.match(/-?\d+/);
  if (!match) return 0;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCookieLike(value: unknown): value is BrowserCookie {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.domain === 'string' &&
    typeof record.name === 'string' &&
    typeof record.value === 'string'
  );
}

function loadCookieFile(cookiePath: string): BrowserCookie[] {
  if (!fs.existsSync(cookiePath)) {
    throw new Error(
      [
        'Money Forward cookie file was not found.',
        `Checked path: ${cookiePath}`,
        'Set MONEYFORWARD_COOKIE_PATH to an existing cookie file.',
      ].join(' '),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(cookiePath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse cookie file: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Cookie file must contain a JSON array.');
  }

  const cookies = parsed.filter((item) => isCookieLike(item)) as BrowserCookie[];
  if (cookies.length === 0) {
    throw new Error('Cookie file does not contain valid cookies.');
  }

  return cookies;
}

function cookieDomainMatches(hostname: string, cookie: BrowserCookie): boolean {
  const normalizedDomain = cookie.domain.replace(/^\./, '').toLowerCase();
  const host = hostname.toLowerCase();

  if (cookie.hostOnly || !cookie.domain.startsWith('.')) {
    return host === normalizedDomain;
  }

  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
}

function cookiePathMatches(pathname: string, cookie: BrowserCookie): boolean {
  const cookiePath = cookie.path || '/';
  return pathname.startsWith(cookiePath);
}

function isCookieExpired(cookie: BrowserCookie, nowSeconds: number): boolean {
  if (typeof cookie.expirationDate !== 'number') return false;
  return cookie.expirationDate <= nowSeconds;
}

function buildCookieHeader(cookies: BrowserCookie[], url: URL, now: Date): string {
  const nowSeconds = now.getTime() / 1000;

  const filtered = cookies.filter((cookie) => {
    if (isCookieExpired(cookie, nowSeconds)) return false;
    if (!cookieDomainMatches(url.hostname, cookie)) return false;
    if (!cookiePathMatches(url.pathname, cookie)) return false;
    if (cookie.secure && url.protocol !== 'https:') return false;
    return true;
  });

  return filtered.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function fetchHtmlWithCookies(
  targetUrl: string,
  cookies: BrowserCookie[],
  now: Date,
): Promise<{ html: string; finalUrl: string }> {
  const url = new URL(targetUrl);
  const cookieHeader = buildCookieHeader(cookies, url, now);
  if (!cookieHeader) {
    throw new Error(`No applicable cookies were found for ${url.hostname}.`);
  }

  const response = await fetch(targetUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      Cookie: cookieHeader,
    },
  });

  const finalUrl = response.url;
  if (!response.ok) {
    throw new Error(`Money Forward request failed (${response.status}) at ${finalUrl}`);
  }

  const html = await response.text();
  const redirectedToSignIn = /id\.moneyforward\.com\/sign_in/.test(finalUrl);
  const htmlShowsSignIn = /id\.moneyforward\.com\/sign_in/.test(html);

  if (redirectedToSignIn || htmlShowsSignIn || !html.includes('/sign_out')) {
    throw new Error(
      'Money Forward session appears to be invalid. Refresh .cookies/moneyforward.com.cookie.json.',
    );
  }

  return { html, finalUrl };
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

function parseMonthlyCashFlow(html: string, fallbackMonth: string): {
  month: string;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  transactionCount: number;
} {
  const rowMatch = html.match(
    /<tr[^>]*class="js-monthly_total"[^>]*>([\s\S]*?)<\/tr>/i,
  );

  const tdValues: string[] = [];
  if (rowMatch) {
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    for (const tdMatch of rowMatch[1].matchAll(tdPattern)) {
      tdValues.push(tdMatch[1] || '');
    }
  }

  const income = parseJapaneseYen(tdValues[0] || '0');
  const expense = parseJapaneseYen(tdValues[2] || '0');
  const balance = parseJapaneseYen(tdValues[4] || String(income - expense));

  const transactionCount = (html.match(/id="js-transaction-/g) || []).length;
  const dateLabelMatch = html.match(
    /<span[^>]*class="yyyy-mm-dd"[^>]*>([0-9]{4}-[0-9]{2}-[0-9]{2})<\/span>/i,
  );
  const month = dateLabelMatch ? dateLabelMatch[1].slice(0, 7) : fallbackMonth;

  return {
    month,
    totalIncome: income,
    totalExpense: expense,
    balance,
    transactionCount,
  };
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

function toDatePathPart(value: string): string {
  return value.replace(/-/g, '/');
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
  const parts = parseDateKey(dateKey);
  const from = `${parts.year}/${parts.month}/01`;
  const to = toDatePathPart(dateKey);

  return {
    history: `${MONEYFORWARD_BASE_URL}/bs/history`,
    historyList: `${MONEYFORWARD_BASE_URL}/bs/history/list/${dateKey}`,
    cashFlow:
      `${MONEYFORWARD_BASE_URL}/cf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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
  };
}
