import { prisma } from "../database/client.js";
import { rebuildMatches } from "../matching/matcher.js";
import { createScraper } from "../scrapers/index.js";
import { saveProducts } from "../services/catalogService.js";
import { CancelledError, STORES, StoreBlockedError, type StoreName } from "../types.js";
import { formatCount, formatDuration } from "../utils/text.js";

const controllers = new Map<string, AbortController>();

export function cancelJob(id: string) {
  controllers.get(id)?.abort();
}

export async function executeJob(jobId: string) {
  const existing = controllers.get(jobId);
  if (existing) return;
  const job = await prisma.scrapeJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "queued") return;

  const controller = new AbortController();
  controllers.set(jobId, controller);
  const started = Date.now();
  let log = "";
  let productsFound = 0;
  let productsNew = 0;
  let productsUpdated = 0;
  let errorCount = 0;
  const stores = job.stores.split(",").filter((store): store is StoreName => STORES.includes(store as StoreName));
  const categoryFilters = parseCategories(job.categoryFilter);

  const flush = async (status = "running", message?: string) => {
    await prisma.scrapeJob.update({
      where: { id: jobId },
      data: {
        status,
        log: log.slice(-180000),
        productsFound,
        productsNew,
        productsUpdated,
        errorCount,
        message,
        startedAt: job.startedAt ?? new Date(started),
        finishedAt: status === "running" ? null : new Date(),
      },
    });
  };

  const push = async (line: string) => {
    log += `${line}\n`;
    console.log(line);
    await flush();
  };

  try {
    await flush();
    for (const store of stores) {
      if (controller.signal.aborted) throw new CancelledError();
      const storeStarted = Date.now();
      const scraper = createScraper(store);
      try {
        for await (const event of scraper.collect({
          categoryIds: categoryFilters[store],
          maxPages: job.maxPages,
          delayMs: job.delayMs,
          signal: controller.signal,
        })) {
          if (event.type === "log") await push(event.message);
          if (event.type === "error") {
            errorCount += 1;
            await push(event.message);
          }
          if (event.type === "products") {
            const saved = await saveProducts(event.products);
            productsFound += saved.found;
            productsNew += saved.created;
            productsUpdated += saved.updated;
            await push(`[${store}] ${formatCount(saved.created)} novos, ${formatCount(saved.updated)} atualizados`);
          }
        }
      } catch (error) {
        if (error instanceof CancelledError || controller.signal.aborted) throw new CancelledError();
        errorCount += 1;
        const message = error instanceof StoreBlockedError ? error.message : error instanceof Error ? error.message : String(error);
        await push(`[${store}] ${message}`);
      }
      await push(`[${store}] Tempo de execução: ${formatDuration(Date.now() - storeStarted)}`);
    }

    await push("[Base] Recalculando correspondências entre lojas");
    const matching = await rebuildMatches();
    await push(`[Base] ${formatCount(matching.groups)} grupos comparáveis ou para revisão`);
    await flush("completed", errorCount ? "Coleta concluída com erros parciais" : "Coleta concluída");
  } catch (error) {
    if (error instanceof CancelledError || controller.signal.aborted) {
      await flush("cancelled", "Coleta cancelada");
      return;
    }
    errorCount += 1;
    await push(`[Base] ${error instanceof Error ? error.message : String(error)}`);
    await flush("failed", "A coleta falhou");
  } finally {
    controllers.delete(jobId);
  }
}

function parseCategories(value: string | null): Partial<Record<StoreName, string[]>> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Partial<Record<StoreName, string[]>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
