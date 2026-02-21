export type ProviderFetchContext = {
  dateKey: string;
  now: Date;
};

export interface MoneyProvider {
  name: string;
  description: string;
  fetch(context: ProviderFetchContext): Promise<unknown>;
}
