export const STORES = ["Cobasi", "Petz", "Petlove", "Alfaderma"] as const;

export type StoreName = (typeof STORES)[number];

export interface ScrapedProduct {
  id: string;
  externalId: string;
  sku?: string;
  ean?: string;
  name: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  species?: string;
  flavor?: string;
  price: number;
  originalPrice?: number;
  discountPercentage?: number;
  packageSize?: string;
  variation?: string;
  productUrl: string;
  imageUrl?: string;
  store: StoreName;
  availability?: string;
  collectedAt: Date;
}

export interface CategoryOption {
  id: string;
  label: string;
  group: string;
}

export interface CollectOptions {
  categoryIds?: string[];
  maxPages?: number | null;
  delayMs: number;
  signal?: AbortSignal;
}

export type CollectorEvent =
  | { type: "log"; message: string }
  | { type: "products"; products: ScrapedProduct[] }
  | { type: "error"; message: string };

export interface Scraper {
  store: StoreName;
  listCategories(signal?: AbortSignal): Promise<CategoryOption[]>;
  collect(options: CollectOptions): AsyncGenerator<CollectorEvent>;
}

export class CancelledError extends Error {
  constructor() {
    super("Coleta cancelada");
    this.name = "CancelledError";
  }
}

export class StoreBlockedError extends Error {
  constructor(store: StoreName, detail: string) {
    super(`${store} bloqueou o acesso automático. ${detail}`);
    this.name = "StoreBlockedError";
  }
}

export function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new CancelledError();
}
