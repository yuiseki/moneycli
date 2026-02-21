import path from 'path';
import { pathToFileURL } from 'url';
import { type MoneyCliConfig } from '../config';
import { createMoneyForwardProvider } from './money-forward/provider';
import { type MoneyProvider } from './types';

export type ProviderCatalogEntry = {
  provider: MoneyProvider;
  source: 'builtin' | 'external';
  modulePath?: string;
};

type ProviderModuleShape = {
  default?: unknown;
  provider?: unknown;
  createProvider?: (config?: MoneyCliConfig) => unknown | Promise<unknown>;
};

function isMoneyProvider(value: unknown): value is MoneyProvider {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    typeof record.fetch === 'function'
  );
}

async function loadProviderFromModulePath(
  modulePath: string,
  config: MoneyCliConfig,
): Promise<MoneyProvider> {
  const resolvedPath = path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(process.cwd(), modulePath);

  const imported = (await import(pathToFileURL(resolvedPath).href)) as ProviderModuleShape;

  let candidate: unknown;
  if (typeof imported.createProvider === 'function') {
    candidate = await imported.createProvider(config);
  } else {
    candidate = imported.default ?? imported.provider;
  }

  if (!isMoneyProvider(candidate)) {
    throw new Error(`Module does not export a valid provider: ${resolvedPath}`);
  }

  return candidate;
}

export async function loadProviderCatalog(config: MoneyCliConfig): Promise<ProviderCatalogEntry[]> {
  const entries: ProviderCatalogEntry[] = [
    {
      provider: createMoneyForwardProvider(config),
      source: 'builtin',
    },
  ];

  for (const modulePath of config.MONEYCLI_PROVIDER_MODULES) {
    const resolvedPath = path.isAbsolute(modulePath)
      ? modulePath
      : path.resolve(process.cwd(), modulePath);

    const provider = await loadProviderFromModulePath(resolvedPath, config);

    entries.push({
      provider,
      source: 'external',
      modulePath: resolvedPath,
    });
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.provider.name)) {
      throw new Error(`Provider name is duplicated: ${entry.provider.name}`);
    }
    seen.add(entry.provider.name);
  }

  return entries;
}

export function resolveProvider(catalog: ProviderCatalogEntry[], name: string): MoneyProvider {
  const matched = catalog.find((entry) => entry.provider.name === name);
  if (matched) {
    return matched.provider;
  }

  const names = catalog.map((entry) => entry.provider.name).join(', ');
  throw new Error(`Unknown provider: ${name}. Available providers: ${names}`);
}
