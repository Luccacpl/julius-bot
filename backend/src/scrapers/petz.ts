import { BrowserSession } from "./browser.js";
import { buildPrice } from "../utils/price.js";
import { sleep } from "../utils/sleep.js";
import { absoluteUrl, formatCount } from "../utils/text.js";
import { readCache, writeCache } from "../utils/cache.js";
import {
  assertActive,
  type CategoryOption,
  type CollectOptions,
  type CollectorEvent,
  type ScrapedProduct,
  type Scraper,
} from "../types.js";

const ORIGIN = "https://www.petz.com.br";

interface PetzNode {
  name?: string;
  token?: string;
  departments?: PetzNode[];
  categories?: PetzNode[];
  subCategories?: PetzNode[];
}

interface PetzVariation {
  id?: string | number;
  sku?: string;
  barcode?: string;
  url?: string;
  token?: string;
  name?: string;
  description?: string;
  price?: number;
  promotionalPrice?: number;
  thumbnail?: string;
  availability?: boolean;
}

interface PetzProduct {
  id?: string | number;
  sku?: string;
  barcode?: string;
  name?: string;
  url?: string;
  token?: string;
  thumbnail?: string;
  price?: number;
  promotional_price?: number;
  brand?: string;
  availability?: string;
  variationName?: string;
  variationDescription?: string;
  categoryList?: string[];
  has_variations?: boolean;
  variations?: PetzVariation[];
}

interface Leaf {
  id: string;
  label: string;
  group: string;
}

export class PetzScraper implements Scraper {
  store = "Petz" as const;
  private session = new BrowserSession();

  async listCategories(): Promise<CategoryOption[]> {
    const cached = await readCache<CategoryOption[]>("petz-categories", 12 * 60 * 60 * 1000);
    if (cached) return cached;
    try {
      await this.session.open(ORIGIN, "Petz");
      const categories = await this.discover();
      await writeCache("petz-categories", categories);
      return categories;
    } finally {
      await this.session.close();
    }
  }

  async *collect(options: CollectOptions): AsyncGenerator<CollectorEvent> {
    const seen = new Set<string>();
    let total = 0;
    try {
      yield { type: "log", message: "[Petz] Abrindo o site em uma janela real do Edge" };
      await this.session.open(ORIGIN, "Petz");
      const categories = await this.discover();
      await writeCache("petz-categories", categories);
      const selected = new Set(options.categoryIds ?? []);
      const leaves = categories.filter((category) => !selected.size || selected.has(category.id));
      yield { type: "log", message: `[Petz] ${formatCount(leaves.length)} categorias para percorrer` };

      for (const leaf of leaves) {
        assertActive(options.signal);
        yield { type: "log", message: `[Petz] Categoria: ${leaf.label}` };
        try {
          total += yield* this.collectLeaf(leaf, options, seen);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "Coleta cancelada") throw error;
          yield { type: "error", message: `[Petz] Erro em ${leaf.label}: ${message}` };
        }
      }
    } finally {
      await this.session.close();
    }
    yield { type: "log", message: `[Petz] Total coletado: ${formatCount(total)} produtos` };
  }

  private async *collectLeaf(leaf: Leaf, options: CollectOptions, seen: Set<string>): AsyncGenerator<CollectorEvent, number> {
    const first = await this.page(leaf.id, 1, options.signal);
    const pageLimit = options.maxPages ?? first.totalPages;
    const pages = Math.min(first.totalPages, pageLimit);
    let collected = 0;
    let payload = first;

    for (let page = 1; page <= pages; page += 1) {
      assertActive(options.signal);
      if (page > 1) {
        await sleep(options.delayMs, options.signal);
        payload = await this.page(leaf.id, page, options.signal);
      }
      yield { type: "log", message: `[Petz] Página ${page}/${payload.totalPages || first.totalPages}` };
      const products = mapPetzProducts(payload.products, new Date()).filter((product) => {
        if (seen.has(product.id)) return false;
        seen.add(product.id);
        return true;
      });
      collected += products.length;
      yield { type: "log", message: `[Petz] ${formatCount(products.length)} produtos encontrados` };
      if (products.length) yield { type: "products", products };
      if (!payload.products.length) break;
    }

    if ((options.maxPages ?? first.totalPages) < first.totalPages) {
      yield { type: "log", message: `[Petz] Limite de páginas atingido em ${leaf.label}` };
    }
    return collected;
  }

  private async page(pathName: string, pageNumber: number, signal?: AbortSignal) {
    assertActive(signal);
    const loaded = await this.session.evaluate(loadPetzPage, { pathName, pageNumber });
    if (loaded.status === 403) {
      await this.session.open(`${ORIGIN}${pathName}`, "Petz");
      const retried = await this.session.evaluate(loadPetzPage, { pathName, pageNumber });
      if (retried.status >= 400) throw new Error(`HTTP ${retried.status} ao ler a página ${pageNumber}`);
      return parsePetzPage(retried.text);
    }
    if (loaded.status >= 400) throw new Error(`HTTP ${loaded.status} ao ler a página ${pageNumber}`);
    return parsePetzPage(loaded.text);
  }

  private async discover() {
    const menu = await this.session.evaluate(loadPetzMenu, null);
    const nodes = Array.isArray(menu) ? menu : [];
    const unique = new Map(flattenMenu(nodes).map((category) => [category.id, category]));
    return [...unique.values()];
  }
}

async function loadPetzMenu() {
  const response = await fetch("/api/v3/public/menu/departments", { headers: { accept: "application/json" } });
  return response.json();
}

async function loadPetzPage(input: { pathName: string; pageNumber: number }) {
  const response = await fetch(`${input.pathName}?json=products&page=${input.pageNumber}`, {
    headers: { accept: "application/json" },
  });
  return { status: response.status, text: await response.text() };
}

function parsePetzPage(text: string) {
  const body = JSON.parse(text) as { result?: { total_pages?: string; total_products?: string; products?: PetzProduct[] } };
  const result = body.result ?? {};
  return {
    totalPages: Math.max(1, Number(result.total_pages) || 1),
    totalProducts: Number(result.total_products) || 0,
    products: result.products ?? [],
  };
}

function flattenMenu(nodes: PetzNode[], trail: string[] = [], group = ""): CategoryOption[] {
  const categories: CategoryOption[] = [];
  for (const node of nodes ?? []) {
    const name = node.name?.trim() || "";
    const nextTrail = name && name !== "Home" ? [...trail, name] : trail;
    const currentGroup = group || (name && name !== "Home" ? name : "");
    const children = [...(node.departments ?? []), ...(node.categories ?? []), ...(node.subCategories ?? [])];
    if (children.length) {
      categories.push(...flattenMenu(children, nextTrail, currentGroup));
      continue;
    }
    if (!node.token?.startsWith("http")) continue;
    const pathname = new URL(node.token).pathname.replace(/\/$/, "");
    if (!pathname || pathname === "/" || pathname.includes("/produto")) continue;
    categories.push({ id: pathname, label: nextTrail.join(" > ") || pathname, group: currentGroup || "Petz" });
  }
  return categories;
}

function mapPetzProducts(products: PetzProduct[], collectedAt: Date) {
  const mapped: ScrapedProduct[] = [];
  for (const product of products) {
    const variants = product.variations?.length
      ? product.variations
      : [{
          sku: product.sku,
          barcode: product.barcode,
          url: product.url || product.token,
          name: product.variationName,
          description: product.variationDescription,
          price: product.price,
          promotionalPrice: product.promotional_price,
          thumbnail: product.thumbnail,
          availability: product.availability !== "out_of_stock",
        }];

    for (const variant of variants) {
      const pricing = petzPrice(variant.price ?? product.price, variant.promotionalPrice ?? product.promotional_price);
      const sku = String(variant.sku || variant.id || product.sku || product.id || "");
      if (!pricing || !sku || !product.name) continue;
      const size = variant.description || variant.name || product.variationDescription || product.variationName;
      const categories = product.categoryList ?? [];
      mapped.push({
        id: `petz:${sku}`,
        externalId: sku,
        sku,
        ean: variant.barcode || product.barcode || undefined,
        name: size && !product.name.toLowerCase().includes(String(size).toLowerCase()) ? `${product.name} ${size}` : product.name,
        brand: product.brand || undefined,
        species: categories[0],
        category: categories[1],
        subcategory: categories[2],
        packageSize: size,
        variation: size,
        price: pricing.price,
        originalPrice: pricing.originalPrice,
        discountPercentage: pricing.discountPercentage,
        productUrl: absoluteUrl(variant.url || product.url || product.token, ORIGIN),
        imageUrl: absoluteUrl(variant.thumbnail || product.thumbnail, ORIGIN),
        store: "Petz",
        availability: variant.availability === false ? "indisponível" : "disponível",
        collectedAt,
      });
    }
  }
  return mapped;
}

function petzPrice(list?: number, promotional?: number) {
  const base = Number(list);
  const promo = Number(promotional);
  if (promo > 0 && base > promo) return buildPrice(promo, base);
  if (base > 0) return buildPrice(base);
  if (promo > 0) return buildPrice(promo);
  return null;
}
