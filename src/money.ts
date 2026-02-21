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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isCompatibleSnapshotForProvider(snapshot: MoneySnapshot, providerName: string): boolean {
  if (providerName !== 'money_forward') {
    return true;
  }

  if (!isRecord(snapshot.data)) {
    return false;
  }

  if (snapshot.data.kind !== 'money_forward') {
    return false;
  }

  const source = isRecord(snapshot.data.source) ? snapshot.data.source : null;
  const sourceType = typeof source?.type === 'string' ? source.type : null;
  return sourceType === 'money_forward_web';
}

export async function loadMoney(options: LoadMoneyOptions): Promise<LoadedMoney> {
  const now = options.now || new Date();
  const todayDateKey = formatDateKey(now);
  const isToday = options.dateKey === todayDateKey;

  const cacheRoot = getCacheDir(options.cacheDir);
  const cached = loadCache(cacheRoot, options.dateKey, options.provider.name);
  const hasIncompatibleCache = Boolean(
    cached && !isCompatibleSnapshotForProvider(cached, options.provider.name),
  );

  if (!isToday && !options.forceSync) {
    if (hasIncompatibleCache) {
      throw new Error(
        `Incompatible cache snapshot for ${options.dateKey} (${options.provider.name}). `
        + `Run money sync --date ${options.dateKey} to refresh it.`,
      );
    }

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

  if (!options.forceSync && cached && !hasIncompatibleCache) {
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
