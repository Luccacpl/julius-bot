import { BrowserSession } from "./browser.js";
import { buildPrice } from "../utils/price.js";
import { sleep } from "../utils/sleep.js";
import { absoluteUrl, cleanPackageSize, decodeHtml, formatCount } from "../utils/text.js";
import { readCache, writeCache } from "../utils/cache.js";
import {
  assertActive,
  StoreBlockedError,
  type CategoryOption,
  type CollectOptions,
  type CollectorEvent,
  type ScrapedProduct,
  type Scraper,
} from "../types.js";

const ORIGIN = "https://www.petlove.com.br";

interface Leaf {
  id: string;
  label: string;
  group: string;
}

interface ListedProduct {
  name?: string;
  sku?: string;
  url?: string;
  image?: string | string[];
  brand?: { name?: string } | string;
  offers?: { price?: string | number; availability?: string; url?: string };
}

interface PriceRow {
  sku?: string;
  listPrice?: string | number;
  inStock?: boolean | null;
  bestPriceForUser?: { price?: string | number; discountPercentage?: string | number };
}

interface VariantNode {
  sku?: string;
  name?: string;
  image?: string | string[];
  size?: string;
  offers?: { price?: string | number; availability?: string; url?: string };
}

export class PetloveScraper implements Scraper {
  store = "Petlove" as const;
  private session = new BrowserSession();

  async listCategories(): Promise<CategoryOption[]> {
    const cached = await readCache<CategoryOption[]>("petlove-categories", 12 * 60 * 60 * 1000);
    if (cached) return cached;
    try {
      await this.session.open(ORIGIN, "Petlove");
      const categories = await this.discover();
      await writeCache("petlove-categories", categories);
      return categories;
    } finally {
      await this.session.close();
    }
  }

  async *collect(options: CollectOptions): AsyncGenerator<CollectorEvent> {
    const seenSkus = new Set<string>();
    const seenSlugs = new Set<string>();
    let total = 0;
    try {
      yield { type: "log", message: "[Petlove] Abrindo o site em uma janela real do Edge" };
      await this.session.open(ORIGIN, "Petlove");
      const categories = await this.discover();
      await writeCache("petlove-categories", categories);
      const selected = new Set(options.categoryIds ?? []);
      const leaves = categories.filter((category) => !selected.size || selected.has(category.id));
      yield { type: "log", message: `[Petlove] ${formatCount(leaves.length)} categorias para percorrer` };

      for (const leaf of leaves) {
        assertActive(options.signal);
        yield { type: "log", message: `[Petlove] Categoria: ${leaf.label}` };
        try {
          total += yield* this.collectLeaf(leaf, options, seenSkus, seenSlugs);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "Coleta cancelada") throw error;
          yield { type: "error", message: `[Petlove] Erro em ${leaf.label}: ${message}` };
        }
      }
    } finally {
      await this.session.close();
    }
    yield { type: "log", message: `[Petlove] Total coletado: ${formatCount(total)} produtos` };
  }

  private async *collectLeaf(
    leaf: Leaf,
    options: CollectOptions,
    seenSkus: Set<string>,
    seenSlugs: Set<string>,
  ): AsyncGenerator<CollectorEvent, number> {
    const first = await this.listing(leaf.id, 1, options.signal);
    const pageLimit = options.maxPages ?? first.pages;
    const pages = Math.max(1, Math.min(first.pages, pageLimit));
    let collected = 0;
    let previousSku = "";

    for (let page = 1; page <= pages; page += 1) {
      assertActive(options.signal);
      const listing = page === 1 ? first : await this.listing(leaf.id, page, options.signal);
      yield { type: "log", message: `[Petlove] Página ${page}/${first.pages}` };
      const cards = listing.products;
      const firstSku = cards[0]?.sku || "";
      if (page > 1 && firstSku && firstSku === previousSku) break;
      previousSku = firstSku;
      yield { type: "log", message: `[Petlove] ${formatCount(cards.length)} produtos encontrados` };

      const slugs = new Map<string, ListedProduct>();
      for (const card of cards) {
        const slug = slugOf(card.url);
        if (!slug || seenSlugs.has(slug)) continue;
        slugs.set(slug, card);
      }

      for (const [slug, card] of slugs) {
        assertActive(options.signal);
        await sleep(options.delayMs, options.signal);
        try {
          const products = await this.expandSlug(slug, card, leaf, seenSkus);
          seenSlugs.add(slug);
          collected += products.length;
          if (products.length) yield { type: "products", products };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "Coleta cancelada") throw error;
          yield { type: "error", message: `[Petlove] Erro no produto ${slug}: ${message}` };
        }
      }
      if (!cards.length) break;
    }

    if ((options.maxPages ?? first.pages) < first.pages) {
      yield { type: "log", message: `[Petlove] Limite de páginas atingido em ${leaf.label}` };
    }
    return collected;
  }

  private async listing(pathName: string, pageNumber: number, signal?: AbortSignal) {
    assertActive(signal);
    const url = pageNumber > 1 ? `${pathName}?page=${pageNumber}` : pathName;
    let html = await this.html(url);
    if (!html.includes("application/ld+json")) {
      await this.session.open(`${ORIGIN}${url}`, "Petlove");
      html = await this.session.evaluate(() => document.documentElement.outerHTML, undefined as never);
    }
    return parseListing(html);
  }

  private async html(pathName: string) {
    const loaded = await this.session.evaluate(async (input: string) => {
      const response = await fetch(input, { headers: { accept: "text/html" } });
      return { status: response.status, text: await response.text() };
    }, pathName);
    if (loaded.status === 403 || /Just a moment|Um momento/i.test(loaded.text.slice(0, 400))) {
      throw new StoreBlockedError("Petlove", "A página de categoria continuou no desafio de segurança.");
    }
    if (loaded.status >= 400) throw new Error(`HTTP ${loaded.status}`);
    return loaded.text;
  }

  private async expandSlug(slug: string, card: ListedProduct, leaf: Leaf, seenSkus: Set<string>) {
    const priceResponse = await this.session.evaluate(loadPrices, { slug, sku: card.sku || "" });
    const pageResponse = await this.session.evaluate(loadHtml, `/${slug}/p`);

    const prices = new Map<string, PriceRow>();
    if (priceResponse.status < 400) {
      const body = JSON.parse(priceResponse.text) as { productPrices?: PriceRow[] };
      for (const row of body.productPrices ?? []) {
        if (row.sku) prices.set(String(row.sku), row);
      }
    }

    const group = pageResponse.status < 400 ? findGroup(pageResponse.text) : null;
    const variants: VariantNode[] = group?.hasVariant?.length ? group.hasVariant : [cardToVariant(card)];
    const collectedAt = new Date();
    const products: ScrapedProduct[] = [];
    const brand = brandName(group?.brand) || brandName(card.brand);

    for (const variant of variants) {
      const sku = String(variant.sku || card.sku || "");
      if (!sku || seenSkus.has(sku)) continue;
      const row = prices.get(sku);
      const current = numberFrom(row?.bestPriceForUser?.price ?? variant.offers?.price);
      const list = numberFrom(row?.listPrice);
      const pricing = current ? buildPrice(current, list) : null;
      if (!pricing) continue;
      seenSkus.add(sku);
      const size = cleanPackageSize(variant.size);
      const baseName = decodeHtml(variant.name || card.name || group?.name || "Produto Petlove");
      products.push({
        id: `petlove:${sku}`,
        externalId: sku,
        sku,
        name: size && !baseName.toLowerCase().includes(size.toLowerCase()) ? `${baseName} - ${size}` : baseName,
        brand,
        species: leaf.group,
        category: leaf.label.split(" > ")[1],
        subcategory: leaf.label.split(" > ").slice(2).join(" > ") || undefined,
        packageSize: size,
        variation: size,
        productUrl: absoluteUrl(variant.offers?.url || card.url || `/${slug}/p?sku=${sku}`, ORIGIN),
        imageUrl: absoluteUrl(firstImage(variant.image) || firstImage(card.image), ORIGIN),
        store: "Petlove",
        availability: availabilityOf(variant.offers?.availability, row?.inStock),
        collectedAt,
        ...pricing,
      });
    }
    return products;
  }

  private async discover() {
    const paths = new Set(await this.session.evaluate(collectPaths, null));
    const departments = [...paths].map((item) => item.split("/").filter(Boolean)[0]).filter(Boolean);
    for (const department of [...new Set(departments)]) {
      await this.session.open(`${ORIGIN}/${department}`, "Petlove");
      for (const pathName of await this.session.evaluate(collectPaths, null)) paths.add(pathName);
    }
    return leavesFrom(paths);
  }
}

function collectPaths() {
  const blocked = /^(dicas|racas|busca|clube|institucional|blog|servicos|plano-de-saude|plano|assinatura|recompra|minha-conta|parceiros)$/;
  const found = new Set<string>();
  for (const anchor of document.querySelectorAll("a")) {
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      continue;
    }
    if (!url.hostname.endsWith("petlove.com.br")) continue;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2 || parts.length > 4 || parts.at(-1) === "p" || blocked.test(parts[0])) continue;
    found.add(`/${parts.join("/")}`);
  }
  return [...found];
}

async function loadHtml(pathName: string) {
  const response = await fetch(pathName, { headers: { accept: "text/html" } });
  return { status: response.status, text: await response.text() };
}

async function loadPrices(input: { slug: string; sku: string }) {
  const response = await fetch("/leopardo/api/product-prices", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ slug: input.slug, sku: input.sku, firstPurchaseClubTest: false }),
  });
  return { status: response.status, text: await response.text() };
}

function leavesFrom(paths: Set<string>): CategoryOption[] {
  const all = [...paths];
  return all
    .filter((pathName) => !all.some((other) => other !== pathName && other.startsWith(`${pathName}/`)))
    .map((pathName) => {
      const parts = pathName.split("/").filter(Boolean);
      const label = parts.map(titleCase).join(" > ");
      return { id: pathName, label, group: titleCase(parts[0] || "Petlove") };
    });
}

function parseListing(html: string) {
  const blocks = jsonLd(html);
  const itemList = blocks.find((block) => block["@type"] === "ItemList");
  const products = (itemList?.itemListElement?.length
    ? itemList.itemListElement
    : blocks.filter((block) => block["@type"] === "Product")) as ListedProduct[];
  const pageLinks = [...html.matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]));
  const fromLinks = pageLinks.length ? Math.max(...pageLinks) : 1;
  const numberOfItems = Number(itemList?.numberOfItems) || products.length;
  const fromCount = products.length ? Math.ceil(numberOfItems / products.length) : 1;
  return { products, pages: Math.max(fromLinks, fromCount, 1) };
}

function jsonLd(html: string) {
  const blocks: Array<Record<string, any>> = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }
  return blocks;
}

function findGroup(html: string) {
  return jsonLd(html).find((block) => block["@type"] === "ProductGroup") as {
    name?: string;
    brand?: { name?: string } | string;
    hasVariant?: VariantNode[];
  } | undefined;
}

function cardToVariant(card: ListedProduct): VariantNode {
  return {
    sku: card.sku,
    name: card.name,
    image: card.image,
    offers: card.offers,
  };
}

function brandName(brand: { name?: string } | string | undefined) {
  if (!brand) return undefined;
  return decodeHtml(typeof brand === "string" ? brand : brand.name || "") || undefined;
}

function firstImage(image: string | string[] | undefined) {
  if (Array.isArray(image)) return image[0];
  return image;
}

function numberFrom(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function availabilityOf(schema: string | undefined, inStock: boolean | null | undefined) {
  if (typeof inStock === "boolean") return inStock ? "disponível" : "indisponível";
  if (!schema) return "não informado";
  return schema.toLowerCase().includes("instock") ? "disponível" : "indisponível";
}

function slugOf(url: string | undefined) {
  const match = url?.match(/\/([^/?]+)\/p(?:\?|$)/);
  return match?.[1];
}

function titleCase(value: string) {
  return decodeURIComponent(value)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
