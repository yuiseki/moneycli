import { expect, test } from 'vitest';
import { type MoneyCliConfig } from '../src/config';
import { loadProviderCatalog, resolveProvider } from '../src/providers/registry';

function sampleConfig(): MoneyCliConfig {
  return {
    MONEYCLI_CACHE_DIR: '/tmp/moneycli-cache',
    MONEYCLI_PROVIDER: 'money_forward',
    MONEYCLI_PROVIDER_MODULES: [],
    MONEYFORWARD_COOKIE_PATH: '/tmp/moneyforward.cookie.json',
  };
}

test('loadProviderCatalog includes builtin money_forward provider', async () => {
  const catalog = await loadProviderCatalog(sampleConfig());
  const names = catalog.map((entry) => entry.provider.name);

  expect(names).toContain('money_forward');
});

test('resolveProvider returns matched provider and rejects unknown names', async () => {
  const catalog = await loadProviderCatalog(sampleConfig());
  const resolved = resolveProvider(catalog, 'money_forward');

  expect(resolved.name).toBe('money_forward');
  expect(() => resolveProvider(catalog, 'unknown')).toThrow('Unknown provider: unknown.');
});
