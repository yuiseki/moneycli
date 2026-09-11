/**
 * Talking to Money Forward with the cookies of a signed-in browser.
 *
 * There is no API, so every page is fetched the way a browser would fetch
 * it, with the cookies exported from one. A session that has lapsed comes
 * back as the sign-in page with a 200, so that is checked here rather than
 * left to surprise a parser with an empty result.
 */
import fs from 'fs';

export const MONEYFORWARD_BASE_URL = 'https://moneyforward.com';

export type BrowserCookie = {
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


function isCookieLike(value: unknown): value is BrowserCookie {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.domain === 'string' &&
    typeof record.name === 'string' &&
    typeof record.value === 'string'
  );
}

export function loadCookieFile(cookiePath: string): BrowserCookie[] {
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

export function buildCookieHeader(cookies: BrowserCookie[], url: URL, now: Date): string {
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

export async function fetchHtmlWithCookies(
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
