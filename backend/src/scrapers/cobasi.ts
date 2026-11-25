import { fetchText } from "../utils/http.js";
import { buildPrice } from "../utils/price.js";
import { sleep } from "../utils/sleep.js";
import { absoluteUrl, cleanPackageSize, formatCount } from "../utils/text.js";
import { readCache, writeCache } from "../utils/cache.js";
import {
  assertActive,
  type CategoryOption,
  type CollectOptions,
  type CollectorEvent,
  type ScrapedProduct,
  type Scraper,
} from "../types.js";

const ORIGIN = "https://www.cobasi.com.br";
const PAGE_SIZE = 50;
const SPLIT_AT = 2400;
const DEFAULT_GROUPS = new Set(["cachorro", "gatos", "passaros", "peixes", "outros-animais", "outros animais"]);

interface VtexCategory {
  id: number;
  name: string;
  url: string;
  children?: VtexCategory[];
}

interface LeafCategory {
  id: string;
  label: string;
  group: string;
  path: string;
}

interface VtexSearchItem {
  itemId: string;
  name?: string;
  nameComplete?: string;
  ean?: string;
  variations?: string[];
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{ commertialOffer?: VtexOffer }>;
  [key: string]: unknown;
}

interface VtexOffer {
  Price?: number;
  ListPrice?: number;
  AvailableQuantity?: number;
  IsAvailable?: boolean;
}

interface VtexProduct {
  productId?: string;
  productName?: string;
  brand?: string;
  linkText?: string;
  link?: string;
  categories?: string[];
  items?: VtexSearchItem[];
  [key: string]: unknown;
}

export class CobasiScraper implements Scraper {
  store = "Cobasi" as const;

  async listCategories(): Promise<CategoryOption[]> {
    const leaves = await this.leaves();
    return leaves.map((leaf) => ({ id: leaf.id, label: leaf.label, group: leaf.group }));
  }

  async *collect(options: CollectOptions): AsyncGenerator<CollectorEvent> {
    const leaves = await this.leaves(options.categoryIds);
    const seen = new Set<string>();
    let total = 0;
    yield { type: "log", message: `[Cobasi] ${formatCount(leaves.length)} categorias para percorrer` };

    for (const leaf of leaves) {
      assertActive(options.signal);
      yield { type: "log", message: `[Cobasi] Categoria: ${leaf.label}` };
      try {
        const collected = yield* this.collectLeaf(leaf, "", undefined, options, seen);
        total += collected;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Coleta cancelada") throw error;
        yield { type: "error", message: `[Cobasi] Erro em ${leaf.label}: ${message}` };
      }
    }

    yield { type: "log", message: `[Cobasi] Total coletado: ${formatCount(total)} produtos` };
  }

  private async *collectLeaf(
    leaf: LeafCategory,
    suffix: string,
    map: string | undefined,
    options: CollectOptions,
    seen: Set<string>,
  ): AsyncGenerator<CollectorEvent, number> {
    const pathName = suffix ? `${leaf.path}/${suffix}` : leaf.path;
    const first = await this.search(pathName, map, 0, PAGE_SIZE - 1, options.signal);
    if (first.total > SPLIT_AT && !suffix) {
      const brands = await this.brands(pathName, map ?? segmentMap(pathName), options.signal);
      if (brands.length > 1) {
        yield { type: "log", message: `[Cobasi] ${leaf.label} tem ${formatCount(first.total)} produtos; dividindo por marca` };
        let collected = 0;
        for (const brand of brands) {
          assertActive(options.signal);
          collected += yield* this.collectLeaf(leaf, brand.value, map ? `${map},b` : segmentMap(pathName) + ",b", options, seen);
        }
        return collected;
      }
    }

    const pageLimit = options.maxPages ?? Number.POSITIVE_INFINITY;
    const totalPages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
    let collected = 0;
    let page = 1;
    let batch = first.products;

    while (page <= pageLimit) {
      assertActive(options.signal);
      yield { type: "log", message: `[Cobasi] Página ${page}/${totalPages}` };
      const products = this.mapProducts(batch, new Date());
      const fresh = products.filter((product) => {
        if (seen.has(product.id)) return false;
        seen.add(product.id);
        return true;
      });
      collected += fresh.length;
      yield { type: "log", message: `[Cobasi] ${formatCount(fresh.length)} produtos encontrados` };
      if (fresh.length) yield { type: "products", products: fresh };

      if (batch.length < PAGE_SIZE || page * PAGE_SIZE >= first.total || page >= pageLimit) break;
      await sleep(options.delayMs, options.signal);
      page += 1;
      const next = await this.search(pathName, map, (page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1, options.signal);
      batch = next.products;
      if (!batch.length) break;
    }

    if (Number.isFinite(pageLimit) && pageLimit < totalPages) {
      yield { type: "log", message: `[Cobasi] Limite de ${pageLimit} páginas atingido em ${leaf.label}` };
    }
    return collected;
  }

  private mapProducts(products: VtexProduct[], collectedAt: Date): ScrapedProduct[] {
    const mapped: ScrapedProduct[] = [];
    for (const product of products) {
      const parts = (product.categories?.[0] || "").split("/").filter(Boolean);
      const species = parts[0];
      const category = parts[1] || parts[0];
      const subcategory = parts[2] || parts[1];
      const flavor = specValue(product, /sabor/i);
      const specSize = specValue(product, /peso|volume|quantidade|tamanho/i);
      for (const item of product.items ?? []) {
        const picked = pickOffer(item.sellers ?? []);
        if (!picked) continue;
        const pricing = buildPrice(Number(picked.Price), Number(picked.ListPrice));
        if (!pricing) continue;
        const variation = variationLabel(item);
        const packageSize = cleanPackageSize(variation || specSize || item.nameComplete || product.productName);
        const link = absoluteUrl(product.link || (product.linkText ? `/${product.linkText}/p` : undefined), ORIGIN);
        const productUrl = link.includes("skuId=") ? link : `${link}${link.includes("?") ? "&" : "?"}skuId=${item.itemId}`;
        mapped.push({
          id: `cobasi:${item.itemId}`,
          externalId: String(item.itemId),
          sku: String(item.itemId),
          ean: item.ean || undefined,
          name: item.nameComplete || item.name || product.productName || "Produto Cobasi",
          brand: product.brand || undefined,
          category,
          subcategory,
          species,
          flavor,
          packageSize,
          variation,
          productUrl,
          imageUrl: item.images?.[0]?.imageUrl,
          store: "Cobasi",
          availability: picked.IsAvailable && Number(picked.AvailableQuantity) > 0 ? "disponível" : "indisponível",
          collectedAt,
          ...pricing,
        });
      }
    }
    return mapped;
  }

  private async search(pathName: string, map: string | undefined, from: number, to: number, signal?: AbortSignal) {
    const params = new URLSearchParams({ _from: String(from), _to: String(to) });
    if (map) params.set("map", map);
    const url = `${ORIGIN}/api/catalog_system/pub/products/search/${pathName}?${params}`;
    const response = await fetchText(url, signal);
    if (response.status === 403 || response.status === 401) {
      throw new Error("A API pública de catálogo da Cobasi recusou a coleta");
    }
    if (response.status >= 400) throw new Error(`HTTP ${response.status} na busca da categoria`);
    const products = JSON.parse(response.text) as VtexProduct[];
    const resources = response.headers.get("resources") || "";
    const total = Number(resources.split("/")[1] || products.length);
    return { products: Array.isArray(products) ? products : [], total: Number.isFinite(total) ? total : products.length };
  }

  private async brands(pathName: string, map: string | undefined, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (map) params.set("map", map);
    const url = `${ORIGIN}/api/catalog_system/pub/facets/search/${pathName}?${params}`;
    const response = await fetchText(url, signal);
    if (response.status >= 400) return [];
    const body = JSON.parse(response.text) as { Brands?: Array<{ Name?: string; Value?: string; Quantity?: number }> };
    return (body.Brands ?? [])
      .filter((brand) => brand.Value && (brand.Quantity ?? 0) > 0)
      .map((brand) => ({ name: brand.Name || brand.Value!, value: brand.Value! }));
  }

  private async leaves(categoryIds?: string[]) {
    const cached = await readCache<VtexCategory[]>("cobasi-tree", 6 * 60 * 60 * 1000);
    const tree = cached ?? (await this.tree());
    if (!cached) await writeCache("cobasi-tree", tree);
    const wanted = new Set(categoryIds ?? []);
    const leaves: LeafCategory[] = [];

    const visit = (node: VtexCategory, group: string, label: string, ancestorSelected: boolean) => {
      const name = node.name?.trim();
      if (!name || /teste/i.test(name)) return;
      const nextLabel = label ? `${label} > ${name}` : name;
      const chosen = ancestorSelected || wanted.has(String(node.id));
      const children = node.children ?? [];
      if (!children.length) {
        const include = categoryIds?.length ? chosen : DEFAULT_GROUPS.has(foldKey(group));
        if (!include) return;
        leaves.push({
          id: String(node.id),
          label: nextLabel,
          group,
          path: new URL(node.url).pathname.replace(/^\/|\/$/g, ""),
        });
        return;
      }
      for (const child of children) visit(child, group, nextLabel, chosen);
    };

    for (const department of tree) visit(department, department.name, "", false);
    return leaves;
  }

  private async tree() {
    const response = await fetchText(`${ORIGIN}/api/catalog_system/pub/category/tree/3`);
    if (response.status >= 400) throw new Error("Não foi possível ler as categorias da Cobasi");
    return JSON.parse(response.text) as VtexCategory[];
  }
}

function foldKey(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function segmentMap(pathName: string) {
  return pathName.split("/").filter(Boolean).map(() => "c").join(",");
}

function specValue(product: VtexProduct, pattern: RegExp) {
  for (const [key, value] of Object.entries(product)) {
    if (!pattern.test(key)) continue;
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

function variationLabel(item: VtexSearchItem) {
  const parts = (item.variations ?? []).map((key) => {
    const value = item[key];
    if (Array.isArray(value)) return value.map(String).join(", ");
    return value ? String(value) : "";
  }).filter(Boolean);
  return parts.join(" · ") || undefined;
}

function pickOffer(sellers: Array<{ commertialOffer?: VtexOffer }>) {
  const offers = sellers
    .map((seller) => seller.commertialOffer)
    .filter((offer): offer is VtexOffer => Boolean(offer && Number(offer.Price) > 0));
  const available = offers.filter((offer) => offer.IsAvailable);
  const pool = available.length ? available : offers;
  pool.sort((left, right) => Number(left.Price) - Number(right.Price));
  return pool[0];
}
