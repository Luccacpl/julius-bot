import type { Prisma } from "@prisma/client";
import { prisma } from "../database/client.js";
import { STORES, type StoreName } from "../types.js";

export interface CatalogFilters {
  search?: string;
  category?: string;
  brand?: string;
  store?: string;
  promo?: boolean;
  comparable?: boolean;
  reduced?: boolean;
  sort?: "price" | "name" | "discount";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

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
  prices: Partial<Record<StoreName, PriceCell>>;
  lowestPrice: number | null;
  lowestStore: StoreName | null;
  comparable: boolean;
  onSale: boolean;
  priceReduced: boolean;
  matchStatus: string | null;
  similarity: number | null;
}

const productSelect = {
  id: true,
  store: true,
  name: true,
  brand: true,
  category: true,
  subcategory: true,
  species: true,
  price: true,
  originalPrice: true,
  discountPercentage: true,
  previousPrice: true,
  packageSize: true,
  productUrl: true,
  imageUrl: true,
  availability: true,
  collectedAt: true,
} satisfies Prisma.ProductSelect;

type ListedProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

export async function queryCatalog(filters: CatalogFilters) {
  const rows = await buildRows();
  const filtered = applyFilters(rows, filters);
  const sorted = sortRows(filtered, filters.sort ?? "price", filters.direction ?? "asc");
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
  const start = (page - 1) * pageSize;
  return {
    total: sorted.length,
    page,
    pageSize,
    rows: sorted.slice(start, start + pageSize),
  };
}

export async function listRows(filters: CatalogFilters) {
  return sortRows(applyFilters(await buildRows(), filters), filters.sort ?? "price", filters.direction ?? "asc");
}

export async function listRawProducts(filters: CatalogFilters) {
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return products.filter((product) => {
    if (filters.store && product.store !== filters.store) return false;
    if (filters.category && product.category !== filters.category) return false;
    if (filters.brand && product.brand !== filters.brand) return false;
    if (filters.promo && !(product.discountPercentage && product.discountPercentage > 0)) return false;
    if (filters.reduced && !(product.previousPrice != null && product.price < product.previousPrice - 0.009)) return false;
    if (filters.search && !`${product.name} ${product.brand ?? ""} ${product.category ?? ""}`.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });
}

export async function dashboardStats() {
  const [products, groups] = await Promise.all([
    prisma.product.findMany({ select: { store: true, price: true, previousPrice: true, discountPercentage: true, collectedAt: true } }),
    prisma.matchGroup.findMany({ include: { members: { select: { productId: true } } } }),
  ]);
  const comparableGroups = groups.filter((group) => group.status === "auto" || group.status === "confirmed");
  const comparableIds = new Set(comparableGroups.flatMap((group) => group.members.map((member) => member.productId)));
  const lastUpdate = products.reduce<Date | null>((latest, product) => {
    if (!latest || product.collectedAt > latest) return product.collectedAt;
    return latest;
  }, null);
  return {
    totalProducts: products.length,
    byStore: STORES.map((store) => ({ store, count: products.filter((product) => product.store === store).length })),
    comparableProducts: comparableIds.size,
    comparableGroups: comparableGroups.length,
    promotions: products.filter((product) => (product.discountPercentage ?? 0) > 0).length,
    priceReduced: products.filter((product) => product.previousPrice != null && product.price < product.previousPrice - 0.009).length,
    needsReview: groups.filter((group) => group.status === "needs_review").length,
    lastUpdate,
  };
}

export async function filterOptions() {
  const products = await prisma.product.findMany({ select: { category: true, brand: true } });
  return {
    categories: unique(products.map((product) => product.category)),
    brands: unique(products.map((product) => product.brand)),
    stores: STORES,
  };
}

export async function productHistory(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { history: { orderBy: { collectedAt: "asc" } } },
  });
  if (!product) return null;
  const prices = product.history.map((point) => point.price);
  const min = prices.length ? Math.min(...prices) : product.price;
  const max = prices.length ? Math.max(...prices) : product.price;
  const avg = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : product.price;
  const first = prices[0] ?? product.price;
  const last = prices.at(-1) ?? product.price;
  return {
    product,
    min: round(min),
    max: round(max),
    avg: round(avg),
    variationPercent: first ? round(((last - first) / first) * 100) : 0,
  };
}

export async function reviewQueue() {
  return prisma.matchGroup.findMany({
    where: { status: "needs_review" },
    include: { members: { include: { product: true } } },
    orderBy: { similarity: "desc" },
  });
}

async function buildRows(): Promise<CatalogRow[]> {
  const [products, groups] = await Promise.all([
    prisma.product.findMany({ select: productSelect }),
    prisma.matchGroup.findMany({ include: { members: true } }),
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));
  const used = new Set<string>();
  const rows: CatalogRow[] = [];

  for (const group of groups) {
    const members = group.members.map((member) => byId.get(member.productId)).filter((product): product is ListedProduct => Boolean(product));
    if (members.length < 2) continue;
    members.forEach((member) => used.add(member.id));
    rows.push(toRow(group.id, members, group.status, group.similarity, group.canonicalName));
  }

  for (const product of products) {
    if (used.has(product.id)) continue;
    rows.push(toRow(product.id, [product], null, null, product.name));
  }
  return rows;
}

function toRow(id: string, members: ListedProduct[], status: string | null, similarity: number | null, name: string): CatalogRow {
  const prices: CatalogRow["prices"] = {};
  for (const member of members) {
    const store = member.store as StoreName;
    const current = prices[store];
    if (current && current.price <= member.price) continue;
    prices[store] = {
      productId: member.id,
      price: member.price,
      originalPrice: member.originalPrice,
      discountPercentage: member.discountPercentage,
      previousPrice: member.previousPrice,
      url: member.productUrl,
      availability: member.availability,
      packageSize: member.packageSize,
    };
  }
  const priced = STORES.map((store) => ({ store, price: prices[store]?.price })).filter((item): item is { store: StoreName; price: number } => item.price != null);
  priced.sort((left, right) => left.price - right.price);
  const representative = [...members].sort((left, right) => left.name.length - right.name.length)[0];
  const onSale = Object.values(prices).some((cell) => (cell?.discountPercentage ?? 0) > 0);
  const priceReduced = Object.values(prices).some((cell) => cell?.previousPrice != null && cell.price < cell.previousPrice - 0.009);
  return {
    id,
    name,
    brand: representative?.brand ?? null,
    category: representative?.category ?? null,
    subcategory: representative?.subcategory ?? null,
    packageSize: representative?.packageSize ?? null,
    prices,
    lowestPrice: priced[0]?.price ?? null,
    lowestStore: priced[0]?.store ?? null,
    comparable: (status === "auto" || status === "confirmed") && priced.length > 1,
    onSale,
    priceReduced,
    matchStatus: status,
    similarity,
  };
}

function applyFilters(rows: CatalogRow[], filters: CatalogFilters) {
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (search && !`${row.name} ${row.brand ?? ""} ${row.category ?? ""}`.toLowerCase().includes(search)) return false;
    if (filters.category && row.category !== filters.category) return false;
    if (filters.brand && row.brand !== filters.brand) return false;
    if (filters.store && !row.prices[filters.store as StoreName]) return false;
    if (filters.promo && !row.onSale) return false;
    if (filters.comparable && !row.comparable) return false;
    if (filters.reduced && !row.priceReduced) return false;
    return true;
  });
}

function sortRows(rows: CatalogRow[], sort: CatalogFilters["sort"], direction: CatalogFilters["direction"]) {
  const factor = direction === "desc" ? -1 : 1;
  return [...rows].sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name, "pt-BR") * factor;
    if (sort === "discount") {
      const leftDiscount = Math.max(0, ...Object.values(left.prices).map((cell) => cell?.discountPercentage ?? 0));
      const rightDiscount = Math.max(0, ...Object.values(right.prices).map((cell) => cell?.discountPercentage ?? 0));
      return (rightDiscount - leftDiscount) * (direction === "asc" ? -1 : 1);
    }
    const leftPrice = left.lowestPrice ?? Number.POSITIVE_INFINITY;
    const rightPrice = right.lowestPrice ?? Number.POSITIVE_INFINITY;
    return (leftPrice - rightPrice) * factor;
  });
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right, "pt-BR"));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
