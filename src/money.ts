import { formatDateKey } from './date';
import { type MoneyProvider } from './providers/types';
import { getCacheDir, loadCache, saveCache } from './storage';
import { type LoadedMoney, type MoneySnapshot } from './types';

export type LoadMoneyOptions = {
  provider: MoneyProvider;
  dateKey: string;
  cacheDir: string;
  forceSync?: boolean;
  now?: Date;
};

export async function loadMoney(options: LoadMoneyOptions): Promise<LoadedMoney> {
  const now = options.now || new Date();
  const todayDateKey = formatDateKey(now);
  const isToday = options.dateKey === todayDateKey;

  const cacheRoot = getCacheDir(options.cacheDir);
  const cached = loadCache(cacheRoot, options.dateKey, options.provider.name);

  if (!isToday && !options.forceSync) {
    if (!cached) {
      throw new Error(`No cache snapshot for ${options.dateKey} (${options.provider.name}).`);
    }

    return {
      fromCache: true,
      dateKey: options.dateKey,
      provider: options.provider.name,
      snapshot: cached,
    };
  }

  if (!options.forceSync && cached) {
    return {
      fromCache: true,
      dateKey: options.dateKey,
      provider: options.provider.name,
      snapshot: cached,
    };
  }

  const fetched = await options.provider.fetch({
    dateKey: options.dateKey,
    now,
  });

  const snapshot: MoneySnapshot = {
    version: 1,
    provider: options.provider.name,
    dateKey: options.dateKey,
    fetchedAt: now.toISOString(),
    data: fetched,
  };

  saveCache(cacheRoot, options.dateKey, options.provider.name, snapshot);

  return {
    fromCache: false,
    dateKey: options.dateKey,
    provider: options.provider.name,
    snapshot,
  };
}
