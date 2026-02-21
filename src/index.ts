#!/usr/bin/env node
import path from 'path';
import { Command } from 'commander';
import { config, setConfigOverrides, type MoneyCliConfig } from './config';
import { parseDateOption } from './date';
import { formatMoneyReport } from './format';
import { detectLocale, localizedText, type AppLocale } from './i18n';
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

type CliMessages = {
  optionDate: string;
  optionProvider: string;
  optionJson: string;
  optionCacheDir: string;
  optionSync: string;
  programDescription: string;
  listDescription: string;
  syncDescription: string;
  providersDescription: string;
  syncCompleted: string;
  labelDate: string;
  labelProvider: string;
  labelCacheDir: string;
  labelDefaultProvider: string;
  providersHeader: string;
  sourceBuiltin: string;
  sourceExternal: string;
  errorPrefix: string;
};

function getCliMessages(locale: AppLocale): CliMessages {
  return {
    optionDate: localizedText(locale, 'Target date (default: today)', '対象日（デフォルト: 今日）'),
    optionProvider: localizedText(locale, 'Provider name (default from config)', 'プロバイダー名（デフォルトは設定値）'),
    optionJson: localizedText(locale, 'Output as JSON', 'JSON形式で出力'),
    optionCacheDir: localizedText(locale, 'Override cache directory', 'キャッシュディレクトリを上書き'),
    optionSync: localizedText(locale, 'Force provider fetch and overwrite cache', 'プロバイダーから強制取得してキャッシュを上書き'),
    programDescription: localizedText(locale, 'Money CLI with provider plugins and date-based cache', 'プロバイダープラグインと日付キャッシュに対応した家計CLI'),
    listDescription: localizedText(locale, 'Show money snapshot', '対象日のスナップショットを表示'),
    syncDescription: localizedText(locale, 'Force provider fetch and write cache for the target date', '対象日をプロバイダーから強制取得してキャッシュ保存'),
    providersDescription: localizedText(locale, 'List available providers', '利用可能なプロバイダー一覧を表示'),
    syncCompleted: localizedText(locale, 'Sync completed.', '同期が完了しました。'),
    labelDate: localizedText(locale, 'Date', '日付'),
    labelProvider: localizedText(locale, 'Provider', 'プロバイダー'),
    labelCacheDir: localizedText(locale, 'Cache dir', 'キャッシュディレクトリ'),
    labelDefaultProvider: localizedText(locale, 'Default provider', 'デフォルトプロバイダー'),
    providersHeader: localizedText(locale, 'Providers', 'プロバイダー一覧'),
    sourceBuiltin: localizedText(locale, 'builtin', '内蔵'),
    sourceExternal: localizedText(locale, 'external', '外部'),
    errorPrefix: localizedText(locale, 'Error', 'エラー'),
  };
}

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

async function executeList(
  options: ListOptions,
  locale: AppLocale,
): Promise<void> {
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

  console.log(formatMoneyReport(loaded, { locale }));
}

async function executeSync(
  options: SyncOptions,
  messages: CliMessages,
): Promise<void> {
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

  console.log(messages.syncCompleted);
  console.log(`${messages.labelDate}: ${payload.date}`);
  console.log(`${messages.labelProvider}: ${payload.provider}`);
  console.log(`${messages.labelCacheDir}: ${payload.cacheDir}`);
}

async function executeProviders(options: ProvidersOptions, messages: CliMessages): Promise<void> {
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

  console.log(`${messages.labelDefaultProvider}: ${payload.defaultProvider}`);
  console.log(`${messages.providersHeader}:`);
  for (const provider of payload.providers) {
    const sourceLabel = provider.source === 'builtin'
      ? messages.sourceBuiltin
      : provider.modulePath || messages.sourceExternal;
    console.log(`- ${provider.name} (${sourceLabel}): ${provider.description}`);
  }
}

function configureCommonOptions(command: Command, messages: CliMessages): Command {
  return command
    .option('-d, --date <yyyy-mm-dd>', messages.optionDate)
    .option('-p, --provider <name>', messages.optionProvider)
    .option('-j, --json', messages.optionJson)
    .option('--cache-dir <path>', messages.optionCacheDir);
}

function buildProgram(locale: AppLocale, messages: CliMessages): Command {
  const program = new Command();

  program
    .name('money')
    .description(messages.programDescription)
    .version('0.1.0');

  configureCommonOptions(
    program.command('list', { isDefault: true }).alias('ls').description(messages.listDescription),
    messages,
  )
    .option('--sync', messages.optionSync)
    .action(async (options) => {
      await executeList(options as ListOptions, locale);
    });

  configureCommonOptions(
    program
      .command('sync')
      .description(messages.syncDescription),
    messages,
  ).action(async (options) => {
    await executeSync(options as SyncOptions, messages);
  });

  program
    .command('providers')
    .description(messages.providersDescription)
    .option('-j, --json', messages.optionJson)
    .action(async (options) => {
      await executeProviders(options as ProvidersOptions, messages);
    });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const locale = detectLocale();
  const messages = getCliMessages(locale);
  const program = buildProgram(locale, messages);
  await program.parseAsync(argv);
}

if (require.main === module) {
  const locale = detectLocale();
  const messages = getCliMessages(locale);

  runCli()
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      if (error instanceof Error) {
        console.error(`${messages.errorPrefix}: ${error.message}`);
      } else {
        console.error(`${messages.errorPrefix}:`, error);
      }
      process.exit(1);
    });
}
