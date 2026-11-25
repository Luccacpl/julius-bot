import { packageSizeFromText } from "../matching/fingerprint.js";
import { prisma } from "../database/client.js";
import type { ScrapedProduct } from "../types.js";

export async function saveProducts(products: ScrapedProduct[]) {
  let created = 0;
  let updated = 0;
  for (const product of products) {
    const existing = await prisma.product.findUnique({ where: { id: product.id } });
    if (!existing) {
      await prisma.product.create({
        data: {
          ...productData(product),
          previousPrice: null,
          history: {
            create: historyData(product),
          },
        },
      });
      created += 1;
      continue;
    }

    await prisma.$transaction([
      prisma.product.update({
        where: { id: product.id },
        data: {
          ...productData(product),
          previousPrice: existing.price,
        },
      }),
      prisma.priceHistory.create({
        data: { productId: product.id, ...historyData(product) },
      }),
    ]);
    updated += 1;
  }
  return { created, updated, found: products.length };
}

function productData(product: ScrapedProduct) {
  return {
    id: product.id,
    store: product.store,
    externalId: product.externalId,
    sku: product.sku,
    ean: product.ean,
    name: product.name,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    species: product.species,
    flavor: product.flavor,
    price: product.price,
    originalPrice: product.originalPrice,
    discountPercentage: product.discountPercentage,
    packageSize: product.packageSize || packageSizeFromText(product.name),
    variation: product.variation,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl,
    availability: product.availability,
    collectedAt: product.collectedAt,
  };
}

function historyData(product: ScrapedProduct) {
  return {
    price: product.price,
    originalPrice: product.originalPrice,
    discountPercentage: product.discountPercentage,
    availability: product.availability,
    collectedAt: product.collectedAt,
  };
}
