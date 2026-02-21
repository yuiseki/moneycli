#!/usr/bin/env node
import path from 'path';
import { Command } from 'commander';
import { config, setConfigOverrides, type MoneyCliConfig } from './config';
import { parseDateOption } from './date';
import { formatMoneyReport } from './format';
import { loadMoney } from './money';
import { loadProviderCatalog, resolveProvider, type ProviderCatalogEntry } from './providers/registry';

type CommonOptions = {
  date?: string;
  provider?: string;
  json?: boolean;
  cacheDir?: string;
};

type ListOptions = CommonOptions & {
  sync?: boolean;
};

type SyncOptions = CommonOptions;

type ProvidersOptions = {
  json?: boolean;
};

function configureRuntimeOptions(options: {
  cacheDir?: string;
  provider?: string;
}): void {
  const overrides: Partial<MoneyCliConfig> = {};

  if (options.cacheDir) {
    overrides.MONEYCLI_CACHE_DIR = path.resolve(options.cacheDir);
  }

  if (options.provider) {
    overrides.MONEYCLI_PROVIDER = options.provider.trim();
  }

  if (Object.keys(overrides).length > 0) {
    setConfigOverrides(overrides);
  }
}

async function resolveActiveProvider(name?: string): Promise<{
  catalog: ProviderCatalogEntry[];
  providerName: string;
}> {
  const catalog = await loadProviderCatalog(config);
  const providerName = name?.trim() || config.MONEYCLI_PROVIDER;
  resolveProvider(catalog, providerName);
  return {
    catalog,
    providerName,
  };
}

async function executeList(options: ListOptions): Promise<void> {
  configureRuntimeOptions(options);

  const dateOption = parseDateOption(options.date);
  const { catalog, providerName } = await resolveActiveProvider(options.provider);
  const provider = resolveProvider(catalog, providerName);

  const loaded = await loadMoney({
    provider,
    dateKey: dateOption.dateKey,
    cacheDir: config.MONEYCLI_CACHE_DIR,
    forceSync: Boolean(options.sync),
  });

  const payload = {
    fromCache: loaded.fromCache,
    date: loaded.dateKey,
    provider: loaded.provider,
    fetchedAt: loaded.snapshot.fetchedAt,
    data: loaded.snapshot.data,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(formatMoneyReport(loaded));
}

async function executeSync(options: SyncOptions): Promise<void> {
  configureRuntimeOptions(options);

  const dateOption = parseDateOption(options.date);
  const { catalog, providerName } = await resolveActiveProvider(options.provider);
  const provider = resolveProvider(catalog, providerName);

  const loaded = await loadMoney({
    provider,
    dateKey: dateOption.dateKey,
    cacheDir: config.MONEYCLI_CACHE_DIR,
    forceSync: true,
  });

  const payload = {
    date: loaded.dateKey,
    provider: loaded.provider,
    fetchedAt: loaded.snapshot.fetchedAt,
    cacheDir: config.MONEYCLI_CACHE_DIR,
    data: loaded.snapshot.data,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('Sync completed.');
  console.log(`Date: ${payload.date}`);
  console.log(`Provider: ${payload.provider}`);
  console.log(`Cache dir: ${payload.cacheDir}`);
}

async function executeProviders(options: ProvidersOptions): Promise<void> {
  const catalog = await loadProviderCatalog(config);
  const payload = {
    defaultProvider: config.MONEYCLI_PROVIDER,
    providers: catalog.map((entry) => ({
      name: entry.provider.name,
      description: entry.provider.description,
      source: entry.source,
      modulePath: entry.modulePath || null,
    })),
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Default provider: ${payload.defaultProvider}`);
  console.log('Providers:');
  for (const provider of payload.providers) {
    const sourceLabel = provider.source === 'builtin' ? 'builtin' : provider.modulePath || 'external';
    console.log(`- ${provider.name} (${sourceLabel}): ${provider.description}`);
  }
}

function configureCommonOptions(command: Command): Command {
  return command
    .option('-d, --date <yyyy-mm-dd>', 'Target date (default: today)')
    .option('-p, --provider <name>', 'Provider name (default from config)')
    .option('-j, --json', 'Output as JSON')
    .option('--cache-dir <path>', 'Override cache directory');
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name('money')
    .description('Money CLI with provider plugins and date-based cache')
    .version('0.1.0');

  configureCommonOptions(
    program.command('list', { isDefault: true }).alias('ls').description('Show money snapshot'),
  )
    .option('--sync', 'Force provider fetch and overwrite cache')
    .action(async (options) => {
      await executeList(options as ListOptions);
    });

  configureCommonOptions(
    program
      .command('sync')
      .description('Force provider fetch and write cache for the target date'),
  ).action(async (options) => {
    await executeSync(options as SyncOptions);
  });

  program
    .command('providers')
    .description('List available providers')
    .option('-j, --json', 'Output as JSON')
    .action(async (options) => {
      await executeProviders(options as ProvidersOptions);
    });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

if (require.main === module) {
  runCli()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(`Error: ${error.message}`);
      } else {
        console.error('Error:', error);
      }
      process.exit(1);
    });
}
