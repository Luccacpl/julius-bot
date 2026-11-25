export interface PriceCell {
  productId: string;
  price: number;
  originalPrice: number | null;
  discountPercentage: number | null;
  previousPrice: number | null;
  url: string;
  availability: string | null;
  packageSize: string | null;
}

export interface CatalogRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  packageSize: string | null;
  prices: Partial<Record<"Cobasi" | "Petz" | "Petlove" | "Alfaderma", PriceCell>>;
  lowestPrice: number | null;
  lowestStore: string | null;
  comparable: boolean;
  onSale: boolean;
  priceReduced: boolean;
  matchStatus: string | null;
  similarity: number | null;
}

export interface Stats {
  totalProducts: number;
  byStore: Array<{ store: string; count: number }>;
  comparableProducts: number;
  comparableGroups: number;
  promotions: number;
  priceReduced: number;
  needsReview: number;
  lastUpdate: string | null;
}

export interface Job {
  id: string;
  stores: string;
  status: string;
  productsFound: number;
  productsNew: number;
  productsUpdated: number;
  errorCount: number;
  log: string;
  message: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CategoryOption {
  id: string;
  label: string;
  group: string;
}

export interface Schedule {
  enabled: boolean;
  intervalHours: number;
  stores: string;
  delayMs: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface HistoryResponse {
  product: {
    name: string;
    store: string;
    productUrl: string;
    history: Array<{ price: number; collectedAt: string; availability: string | null }>;
  };
  min: number;
  max: number;
  avg: number;
  variationPercent: number;
}

export interface MatchGroup {
  id: string;
  canonicalName: string;
  brand: string | null;
  packageSize: string | null;
  similarity: number;
  members: Array<{
    product: {
      id: string;
      store: string;
      name: string;
      price: number;
      packageSize: string | null;
      productUrl: string;
    };
  }>;
}

export const stores = ["Cobasi", "Petz", "Petlove", "Alfaderma"] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "Falha na requisição" }));
    throw new Error(body.message || "Falha na requisição");
  }
  return response.json();
}

export const api = {
  stats: () => request<Stats>("/api/stats"),
  filters: () => request<{ categories: string[]; brands: string[]; stores: string[] }>("/api/filters"),
  products: (params: URLSearchParams) => request<{ total: number; page: number; pageSize: number; rows: CatalogRow[] }>(`/api/products?${params}`),
  history: (id: string) => request<HistoryResponse>(`/api/products/${id}/history`),
  categories: (store: string) => request<CategoryOption[]>(`/api/categories/${store}`),
  jobs: () => request<Job[]>("/api/jobs"),
  createJob: (body: unknown) => request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  cancelJob: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  schedule: () => request<Schedule>("/api/schedule"),
  saveSchedule: (body: unknown) => request<Schedule>("/api/schedule", { method: "PUT", body: JSON.stringify(body) }),
  matches: () => request<MatchGroup[]>("/api/matches"),
  decide: (id: string, decision: "confirmed" | "rejected") => request(`/api/matches/${id}/decision`, { method: "POST", body: JSON.stringify({ decision }) }),
};

export function money(value: number | null | undefined) {
  if (value == null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function when(value: string | null) {
  if (!value) return "Ainda não houve coleta";
  return new Date(value).toLocaleString("pt-BR");
}
