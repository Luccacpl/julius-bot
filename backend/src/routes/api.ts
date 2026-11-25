import { Router } from "express";
import { prisma } from "../database/client.js";
import { config } from "../config.js";
import { rebuildMatches } from "../matching/matcher.js";
import { createScraper } from "../scrapers/index.js";
import { exportCatalog } from "../services/exportService.js";
import { dashboardStats, filterOptions, productHistory, queryCatalog, reviewQueue, type CatalogFilters } from "../services/queryService.js";
import { enqueue } from "../queues/scrapeQueue.js";
import { cancelJob } from "../jobs/runner.js";
import { STORES, type StoreName } from "../types.js";

export const api = Router();

api.get("/health", (_request, response) => {
  response.json({ ok: true });
});

api.get("/stats", async (_request, response, next) => {
  try {
    response.json(await dashboardStats());
  } catch (error) {
    next(error);
  }
});

api.get("/filters", async (_request, response, next) => {
  try {
    response.json(await filterOptions());
  } catch (error) {
    next(error);
  }
});

api.get("/products", async (request, response, next) => {
  try {
    response.json(await queryCatalog(readFilters(request.query)));
  } catch (error) {
    next(error);
  }
});

api.get("/products/:id/history", async (request, response, next) => {
  try {
    const history = await productHistory(request.params.id);
    if (!history) {
      response.status(404).json({ message: "Produto não encontrado" });
      return;
    }
    response.json(history);
  } catch (error) {
    next(error);
  }
});

api.get("/categories/:store", async (request, response, next) => {
  try {
    const store = parseStore(request.params.store);
    if (!store) {
      response.status(400).json({ message: "Loja inválida" });
      return;
    }
    const categories = await createScraper(store).listCategories();
    response.json(categories);
  } catch (error) {
    next(error);
  }
});

api.get("/jobs", async (_request, response, next) => {
  try {
    response.json(await prisma.scrapeJob.findMany({ orderBy: { createdAt: "desc" }, take: 20 }));
  } catch (error) {
    next(error);
  }
});

api.get("/jobs/:id", async (request, response, next) => {
  try {
    const job = await prisma.scrapeJob.findUnique({ where: { id: request.params.id } });
    if (!job) {
      response.status(404).json({ message: "Coleta não encontrada" });
      return;
    }
    response.json(job);
  } catch (error) {
    next(error);
  }
});

api.post("/jobs", async (request, response, next) => {
  try {
    const stores = Array.isArray(request.body?.stores) ? request.body.stores.filter(isStore) : [];
    if (!stores.length) {
      response.status(400).json({ message: "Selecione ao menos uma loja" });
      return;
    }
    const categories = sanitizeCategories(request.body?.categories);
    const maxPages = request.body?.maxPages == null || request.body.maxPages === "" ? null : Number(request.body.maxPages);
    if (maxPages != null && (!Number.isInteger(maxPages) || maxPages < 1)) {
      response.status(400).json({ message: "O limite de páginas é inválido" });
      return;
    }
    const delayMs = Math.min(10_000, Math.max(400, Number(request.body?.delayMs) || config.delayMs));
    const job = await prisma.scrapeJob.create({
      data: {
        stores: stores.join(","),
        categoryFilter: categories ? JSON.stringify(categories) : null,
        maxPages,
        delayMs,
        status: "queued",
      },
    });
    enqueue(job.id);
    response.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

api.post("/jobs/:id/cancel", async (request, response, next) => {
  try {
    const job = await prisma.scrapeJob.findUnique({ where: { id: request.params.id } });
    if (!job) {
      response.status(404).json({ message: "Coleta não encontrada" });
      return;
    }
    if (job.status === "queued") {
      const updated = await prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: "cancelled", message: "Coleta cancelada antes de iniciar", finishedAt: new Date() },
      });
      response.json(updated);
      return;
    }
    cancelJob(job.id);
    response.json({ ...job, message: "Cancelamento solicitado" });
  } catch (error) {
    next(error);
  }
});

api.get("/schedule", async (_request, response, next) => {
  try {
    response.json(await ensureSchedule());
  } catch (error) {
    next(error);
  }
});

api.put("/schedule", async (request, response, next) => {
  try {
    const intervalHours = Number(request.body?.intervalHours);
    if (![12, 24, 168].includes(intervalHours)) {
      response.status(400).json({ message: "O intervalo deve ser 12, 24 ou 168 horas" });
      return;
    }
    const stores = Array.isArray(request.body?.stores) ? request.body.stores.filter(isStore) : [];
    if (!stores.length) {
      response.status(400).json({ message: "Selecione ao menos uma loja" });
      return;
    }
    const enabled = Boolean(request.body?.enabled);
    const delayMs = Math.min(10_000, Math.max(400, Number(request.body?.delayMs) || config.delayMs));
    const current = await ensureSchedule();
    const nextRunAt = enabled ? current.nextRunAt ?? new Date(Date.now() + intervalHours * 60 * 60 * 1000) : null;
    const schedule = await prisma.schedule.update({
      where: { id: 1 },
      data: { enabled, intervalHours, stores: stores.join(","), delayMs, nextRunAt },
    });
    response.json(schedule);
  } catch (error) {
    next(error);
  }
});

api.get("/matches", async (_request, response, next) => {
  try {
    response.json(await reviewQueue());
  } catch (error) {
    next(error);
  }
});

api.post("/matches/rebuild", async (_request, response, next) => {
  try {
    response.json(await rebuildMatches());
  } catch (error) {
    next(error);
  }
});

api.post("/matches/:id/decision", async (request, response, next) => {
  try {
    const decision = request.body?.decision === "confirmed" || request.body?.decision === "rejected" ? request.body.decision : null;
    if (!decision) {
      response.status(400).json({ message: "Decisão inválida" });
      return;
    }
    const group = await prisma.matchGroup.findUnique({ where: { id: request.params.id }, include: { members: true } });
    if (!group) {
      response.status(404).json({ message: "Correspondência não encontrada" });
      return;
    }
    const ids = group.members.map((member) => member.productId).sort();
    for (let index = 0; index < ids.length; index += 1) {
      for (let other = index + 1; other < ids.length; other += 1) {
        await prisma.matchReview.upsert({
          where: { productIdA_productIdB: { productIdA: ids[index], productIdB: ids[other] } },
          update: { decision },
          create: { productIdA: ids[index], productIdB: ids[other], decision },
        });
      }
    }
    if (decision === "rejected") {
      await prisma.matchGroup.delete({ where: { id: group.id } });
      response.json({ status: "rejected" });
      return;
    }
    const updated = await prisma.matchGroup.update({ where: { id: group.id }, data: { status: "confirmed" } });
    response.json(updated);
  } catch (error) {
    next(error);
  }
});

api.get("/export", async (request, response, next) => {
  try {
    const format = request.query.format === "xlsx" ? "xlsx" : "csv";
    const kind = request.query.kind === "catalog" ? "catalog" : "comparison";
    const result = await exportCatalog(kind, format, readFilters(request.query));
    response.download(result.file, result.filename);
  } catch (error) {
    next(error);
  }
});

function readFilters(query: Record<string, unknown>): CatalogFilters {
  return {
    search: stringValue(query.search),
    category: stringValue(query.category),
    brand: stringValue(query.brand),
    store: stringValue(query.store),
    promo: query.promo === "true" || query.promo === "1",
    comparable: query.comparable === "true" || query.comparable === "1",
    reduced: query.reduced === "true" || query.reduced === "1",
    sort: query.sort === "name" || query.sort === "discount" ? query.sort : "price",
    direction: query.direction === "desc" ? "desc" : "asc",
    page: Number(query.page) || 1,
    pageSize: Number(query.pageSize) || 25,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isStore(value: unknown): value is StoreName {
  return typeof value === "string" && STORES.includes(value as StoreName);
}

function parseStore(value: string): StoreName | null {
  return isStore(value) ? value : null;
}

function sanitizeCategories(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const output: Partial<Record<StoreName, string[]>> = {};
  for (const store of STORES) {
    const entries = (value as Record<string, unknown>)[store];
    if (!Array.isArray(entries)) continue;
    const ids = entries.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (ids.length) output[store] = ids;
  }
  return Object.keys(output).length ? output : null;
}

async function ensureSchedule() {
  return prisma.schedule.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}
