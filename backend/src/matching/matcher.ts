import type { Product } from "@prisma/client";
import { prisma } from "../database/client.js";
import { compareFingerprints, fingerprintOf, normalizeEan, type Fingerprint } from "./fingerprint.js";

type StoredProduct = Product;

interface Edge {
  a: string;
  b: string;
  score: number;
  status: "confirmed" | "auto" | "needs_review";
}

export async function rebuildMatches() {
  const [products, reviews] = await Promise.all([
    prisma.product.findMany(),
    prisma.matchReview.findMany(),
  ]);
  const confirmed = new Set(reviews.filter((review) => review.decision === "confirmed").map((review) => pair(review.productIdA, review.productIdB)));
  const rejected = new Set(reviews.filter((review) => review.decision === "rejected").map((review) => pair(review.productIdA, review.productIdB)));
  const edges: Edge[] = [];
  const used = new Set<string>();

  for (const [leftId, rightId] of confirmed) {
    if (!products.some((product) => product.id === leftId) || !products.some((product) => product.id === rightId)) continue;
    edges.push({ a: leftId, b: rightId, score: 1, status: "confirmed" });
  }

  const byEan = new Map<string, StoredProduct[]>();
  for (const product of products) {
    const ean = normalizeEan(product.ean);
    if (!ean) continue;
    byEan.set(ean, [...(byEan.get(ean) ?? []), product]);
  }
  for (const group of byEan.values()) {
    const stores = new Set(group.map((product) => product.store));
    if (stores.size < 2) continue;
    for (let index = 0; index < group.length; index += 1) {
      for (let other = index + 1; other < group.length; other += 1) {
        if (group[index].store === group[other].store) continue;
        const key = pair(group[index].id, group[other].id);
        if (rejected.has(key) || confirmed.has(key)) continue;
        edges.push({ a: group[index].id, b: group[other].id, score: 1, status: "confirmed" });
      }
    }
  }

  const fingerprints = new Map<string, Fingerprint>(products.map((product) => [product.id, fingerprintOf(product)]));
  const buckets = new Map<string, StoredProduct[]>();
  for (const product of products) {
    const print = fingerprints.get(product.id)!;
    if (!print.brandKey) continue;
    const size = print.grams != null ? `g${print.grams}` : print.milliliters != null ? `m${print.milliliters}` : print.count != null ? `c${print.count}` : "na";
    const key = `${print.brandKey}|${print.species ?? "unk"}|${size}`;
    buckets.set(key, [...(buckets.get(key) ?? []), product]);
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    for (let index = 0; index < bucket.length; index += 1) {
      for (let other = index + 1; other < bucket.length; other += 1) {
        const left = bucket[index];
        const right = bucket[other];
        if (left.store === right.store) continue;
        const key = pair(left.id, right.id);
        if (rejected.has(key) || confirmed.has(key) || edges.some((edge) => pair(edge.a, edge.b) === key)) continue;
        const decision = compareFingerprints(fingerprints.get(left.id)!, fingerprints.get(right.id)!);
        if (!decision.ok) continue;
        edges.push({ a: left.id, b: right.id, score: decision.score, status: decision.auto ? "auto" : "needs_review" });
      }
    }
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const components = new Map<string, Set<string>>();
  const byId = new Map(products.map((product) => [product.id, product]));

  for (const edge of edges.sort((left, right) => right.score - left.score)) {
    const leftRoot = find(edge.a);
    const rightRoot = find(edge.b);
    const leftMembers = components.get(leftRoot) ?? new Set([edge.a]);
    const rightMembers = components.get(rightRoot) ?? new Set([edge.b]);
    if (leftRoot !== rightRoot) {
      const stores = new Set([...leftMembers, ...rightMembers].map((id) => byId.get(id)?.store));
      if (stores.size !== new Set([...leftMembers, ...rightMembers]).size && hasDuplicateStore(leftMembers, rightMembers, byId)) continue;
      parent.set(rightRoot, leftRoot);
      components.set(leftRoot, new Set([...leftMembers, ...rightMembers]));
      components.delete(rightRoot);
    }
    used.add(edge.a);
    used.add(edge.b);
  }

  await prisma.matchGroup.deleteMany();
  let groups = 0;
  for (const members of components.values()) {
    const items = [...members].flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
    const stores = new Set(items.map((item) => item.store));
    if (items.length < 2 || stores.size < 2) continue;
    const related = edges.filter((edge) => members.has(edge.a) && members.has(edge.b));
    const status = related.some((edge) => edge.status === "needs_review")
      ? "needs_review"
      : related.some((edge) => edge.status === "confirmed")
        ? "confirmed"
        : "auto";
    const similarity = related.length ? Math.min(...related.map((edge) => edge.score)) : 0;
    const sample = items[0];
    const print = fingerprints.get(sample.id);
    await prisma.matchGroup.create({
      data: {
        canonicalName: shortestName(items),
        brand: sample.brand,
        packageSize: print?.sizeLabel || sample.packageSize,
        species: sample.species,
        flavor: print?.flavors.join(", ") || sample.flavor,
        status,
        similarity,
        members: {
          create: items.map((item) => ({
            productId: item.id,
            similarity,
          })),
        },
      },
    });
    groups += 1;
  }
  return { groups, products: products.length, edges: edges.length, matchedProducts: used.size };
}

function pair(left: string, right: string) {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function hasDuplicateStore(left: Set<string>, right: Set<string>, byId: Map<string, StoredProduct>) {
  const stores = new Map<string, number>();
  for (const id of [...left, ...right]) {
    const store = byId.get(id)?.store;
    if (!store) continue;
    stores.set(store, (stores.get(store) ?? 0) + 1);
    if ((stores.get(store) ?? 0) > 1) return true;
  }
  return false;
}

function shortestName(products: StoredProduct[]) {
  return [...products].sort((left, right) => left.name.length - right.name.length)[0]?.name ?? "Produto";
}
