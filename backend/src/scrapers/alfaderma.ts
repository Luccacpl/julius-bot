import { fetchText } from "../utils/http.js";
import { buildPrice } from "../utils/price.js";
import { sleep } from "../utils/sleep.js";
import { formatCount } from "../utils/text.js";
import {
  assertActive,
  type CategoryOption,
  type CollectOptions,
  type CollectorEvent,
  type ScrapedProduct,
  type Scraper,
} from "../types.js";

const ORIGIN = "https://alfaderma.com.br";
const PAGE_LIMIT = 48;

interface AlfadermaProduct {
  id: number;
  name: string;
  slug: string;
  price: number;
  imageUrl?: string | null;
  stockStatus?: string;
  category?: { id: number; name: string } | null;
  company?: { id: number; name: string } | null;
}

interface AlfadermaPage {
  items: AlfadermaProduct[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

export class AlfadermaScraper implements Scraper {
  store = "Alfaderma" as const;

  async listCategories(): Promise<CategoryOption[]> {
    const response = await fetchText(`${ORIGIN}/api/public/products/filters`);
    if (response.status >= 400) throw new Error("Não foi possível ler as categorias da Alfaderma");
    const body = JSON.parse(response.text) as { categories?: Array<{ id: number; name: string }> };
    return (body.categories ?? []).map((category) => ({
      id: String(category.id),
      label: category.name,
      group: "Alfaderma",
    }));
  }

  async *collect(options: CollectOptions): AsyncGenerator<CollectorEvent> {
    const categories = await this.listCategories();
    const selected = new Set(options.categoryIds ?? []);
    const targets = selected.size ? categories.filter((category) => selected.has(category.id)) : [{ id: "", label: "Catálogo", group: "Alfaderma" }];
    const seen = new Set<string>();
    let total = 0;
    yield { type: "log", message: `[Alfaderma] ${formatCount(targets.length)} categorias para percorrer` };

    for (const category of targets) {
      assertActive(options.signal);
      yield { type: "log", message: `[Alfaderma] Categoria: ${category.label}` };
      try {
        total += yield* this.collectCategory(category, options, seen);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "Coleta cancelada") throw error;
        yield { type: "error", message: `[Alfaderma] Erro em ${category.label}: ${message}` };
      }
    }

    yield { type: "log", message: `[Alfaderma] Total coletado: ${formatCount(total)} produtos` };
  }

  private async *collectCategory(
    category: CategoryOption,
    options: CollectOptions,
    seen: Set<string>,
  ): AsyncGenerator<CollectorEvent, number> {
    const first = await this.page(category.id, 1, options.signal);
    const pageLimit = options.maxPages ?? first.pagination.totalPages;
    const pages = Math.max(1, Math.min(first.pagination.totalPages || 1, pageLimit));
    let collected = 0;
    let payload = first;

    for (let page = 1; page <= pages; page += 1) {
      assertActive(options.signal);
      if (page > 1) {
        await sleep(options.delayMs, options.signal);
        payload = await this.page(category.id, page, options.signal);
      }
      yield { type: "log", message: `[Alfaderma] Página ${page}/${first.pagination.totalPages || pages}` };
      const products = payload.items.flatMap((item) => mapProduct(item)).filter((product) => {
        if (seen.has(product.id)) return false;
        seen.add(product.id);
        return true;
      });
      collected += products.length;
      yield { type: "log", message: `[Alfaderma] ${formatCount(products.length)} produtos encontrados` };
      if (products.length) yield { type: "products", products };
      if (!payload.items.length) break;
    }

    if ((options.maxPages ?? first.pagination.totalPages) < first.pagination.totalPages) {
      yield { type: "log", message: `[Alfaderma] Limite de páginas atingido em ${category.label}` };
    }
    return collected;
  }

  private async page(categoryId: string, pageNumber: number, signal?: AbortSignal) {
    const params = new URLSearchParams({ page: String(pageNumber), limit: String(PAGE_LIMIT) });
    if (categoryId) params.set("categoryId", categoryId);
    const response = await fetchText(`${ORIGIN}/api/public/products?${params}`, signal);
    if (response.status === 403 || response.status === 401) throw new Error("A Alfaderma recusou a leitura do catálogo");
    if (response.status >= 400) throw new Error(`HTTP ${response.status} ao ler a página ${pageNumber}`);
    return JSON.parse(response.text) as AlfadermaPage;
  }
}

function mapProduct(item: AlfadermaProduct): ScrapedProduct[] {
  const pricing = buildPrice(Number(item.price));
  if (!pricing || !item.id || !item.name) return [];
  const collectedAt = new Date();
  return [{
    id: `alfaderma:${item.id}`,
    externalId: String(item.id),
    sku: item.slug,
    name: item.name,
    brand: item.company?.name || undefined,
    category: item.category?.name,
    productUrl: `${ORIGIN}/produtos/${item.slug}`,
    imageUrl: item.imageUrl || undefined,
    store: "Alfaderma",
    availability: item.stockStatus === "unavailable" ? "indisponível" : "disponível",
    collectedAt,
    ...pricing,
  }];
}
