export interface MoneySnapshot {
  version: 1;
  provider: string;
  dateKey: string;
  fetchedAt: string;
  data: unknown;
}

export interface LoadedMoney {
  fromCache: boolean;
  dateKey: string;
  provider: string;
  snapshot: MoneySnapshot;
}
