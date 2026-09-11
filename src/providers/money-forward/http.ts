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
  assertSignedIn(html, finalUrl);

  return { html, finalUrl };
}

/**
 * A lapsed session answers with the sign-in page and a 200, so the status
 * code says nothing. Catching it here means a parser never has to explain an
 * empty result that was really an expired cookie.
 */
export function assertSignedIn(html: string, finalUrl: string): void {
  const redirectedToSignIn = /id\.moneyforward\.com\/sign_in/.test(finalUrl);
  const htmlShowsSignIn = /id\.moneyforward\.com\/sign_in/.test(html);

  if (redirectedToSignIn || htmlShowsSignIn || !html.includes('/sign_out')) {
    throw new Error(
      'Money Forward session appears to be invalid. Refresh .cookies/moneyforward.com.cookie.json.',
    );
  }
}

/**
 * A short-lived cookie jar layered over the exported browser cookies.
 *
 * Some pages are only reachable after a POST that changes what the next GET
 * answers with, and the server carries that choice in a Set-Cookie. The
 * overlay holds those replies for the length of one fetch chain and dies with
 * the process: the cookie file is never written back, so nothing here
 * disturbs the browser the cookies came from, and a second run starts from
 * the same place as the first.
 */
export type MoneyForwardSession = {
  get(url: string): Promise<{ html: string; finalUrl: string }>;
  post(url: string, body: string, referer: string): Promise<string>;
};

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** The CSRF token Rails puts in every page, and requires back on any POST. */
export function extractCsrfToken(html: string): string | null {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)"\s*\/?>/i);
  return match ? match[1] : null;
}

export function createSession(cookies: BrowserCookie[], now: Date): MoneyForwardSession {
  const overlay = new Map<string, string>();
  let csrfToken: string | null = null;

  function cookieHeaderFor(url: URL): string {
    const fromFile = buildCookieHeader(cookies, url, now)
      .split('; ')
      .filter((pair) => pair.length > 0)
      .filter((pair) => !overlay.has(pair.slice(0, pair.indexOf('='))));
    const replaced = [...overlay].map(([name, value]) => `${name}=${value}`);
    return [...fromFile, ...replaced].join('; ');
  }

  function absorb(response: Response): void {
    // getSetCookie keeps the individual headers apart. Splitting one joined
    // string would break on the commas inside an Expires date.
    const raw = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    for (const entry of raw) {
      const [pair] = entry.split(';');
      const equals = pair.indexOf('=');
      if (equals > 0) overlay.set(pair.slice(0, equals).trim(), pair.slice(equals + 1));
    }
  }

  return {
    async get(targetUrl: string) {
      const url = new URL(targetUrl);
      const header = cookieHeaderFor(url);
      if (!header) {
        throw new Error(`No applicable cookies were found for ${url.hostname}.`);
      }

      const response = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          Cookie: header,
        },
      });
      absorb(response);

      const finalUrl = response.url;
      if (!response.ok) {
        throw new Error(`Money Forward request failed (${response.status}) at ${finalUrl}`);
      }

      const html = await response.text();
      assertSignedIn(html, finalUrl);
      csrfToken = extractCsrfToken(html) ?? csrfToken;
      return { html, finalUrl };
    },

    async post(targetUrl: string, body: string, referer: string) {
      if (!csrfToken) {
        throw new Error('A page has to be fetched before posting: no CSRF token yet.');
      }

      const response = await fetch(targetUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept: 'text/javascript, text/html, application/xml, */*; q=0.01',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': csrfToken,
          Referer: referer,
          Cookie: cookieHeaderFor(new URL(targetUrl)),
        },
        body,
      });
      absorb(response);

      if (!response.ok) {
        throw new Error(`Money Forward request failed (${response.status}) at ${response.url}`);
      }
      return response.text();
    },
  };
}
