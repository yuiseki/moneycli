import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

dotenv.config({ quiet: true });

export type MoneyCliConfig = {
  MONEYCLI_CACHE_DIR: string;
  MONEYCLI_PROVIDER: string;
  MONEYCLI_PROVIDER_MODULES: string[];
  MONEYFORWARD_COOKIE_PATH: string;
};

const envSchema = z.object({
  MONEYCLI_CACHE_DIR: z.string().optional(),
  MONEYCLI_PROVIDER: z.string().optional(),
  MONEYCLI_PROVIDER_MODULES: z.string().optional(),
  MONEYFORWARD_COOKIE_PATH: z.string().optional(),
});

function defaultCacheDir(): string {
  const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheBase, 'moneycli');
}

function parseProviderModulePaths(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => path.resolve(item));
}

function firstExistingPath(candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function defaultMoneyForwardCookiePath(): string {
  const candidates = [
    path.resolve(process.cwd(), '.cookies/moneyforward.com.cookie.json'),
    path.resolve(process.cwd(), '../.cookies/moneyforward.com.cookie.json'),
  ];
  return firstExistingPath(candidates);
}

function loadConfigFromEnv(): MoneyCliConfig {
  const parsed = envSchema.parse({
    MONEYCLI_CACHE_DIR: process.env.MONEYCLI_CACHE_DIR,
    MONEYCLI_PROVIDER: process.env.MONEYCLI_PROVIDER,
    MONEYCLI_PROVIDER_MODULES: process.env.MONEYCLI_PROVIDER_MODULES,
    MONEYFORWARD_COOKIE_PATH: process.env.MONEYFORWARD_COOKIE_PATH,
  });

  return {
    MONEYCLI_CACHE_DIR: parsed.MONEYCLI_CACHE_DIR
      ? path.resolve(parsed.MONEYCLI_CACHE_DIR)
      : defaultCacheDir(),
    MONEYCLI_PROVIDER: parsed.MONEYCLI_PROVIDER?.trim() || 'money_forward',
    MONEYCLI_PROVIDER_MODULES: parseProviderModulePaths(parsed.MONEYCLI_PROVIDER_MODULES),
    MONEYFORWARD_COOKIE_PATH: parsed.MONEYFORWARD_COOKIE_PATH
      ? path.resolve(parsed.MONEYFORWARD_COOKIE_PATH)
      : defaultMoneyForwardCookiePath(),
  };
}

export let config = loadConfigFromEnv();

export function setConfigOverrides(overrides: Partial<MoneyCliConfig>): void {
  config = {
    ...config,
    ...overrides,
  };
}
