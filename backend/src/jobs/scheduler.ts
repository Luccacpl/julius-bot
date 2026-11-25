import { prisma } from "../database/client.js";
import { STORES, type StoreName } from "../types.js";
import { enqueue, queueSize } from "../queues/scrapeQueue.js";

let timer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch((error) => console.error("[Agenda]", error));
  }, 30_000);
}

async function tick() {
  const schedule = await prisma.schedule.findUnique({ where: { id: 1 } });
  if (!schedule?.enabled || !schedule.nextRunAt || schedule.nextRunAt > new Date()) return;
  if (queueSize() > 0) return;
  const stores = schedule.stores.split(",").filter((store): store is StoreName => STORES.includes(store as StoreName));
  const job = await prisma.scrapeJob.create({
    data: {
      stores: stores.join(","),
      delayMs: Math.max(400, schedule.delayMs),
      status: "queued",
      message: "Coleta agendada",
    },
  });
  const next = new Date(Date.now() + schedule.intervalHours * 60 * 60 * 1000);
  await prisma.schedule.update({
    where: { id: 1 },
    data: { lastRunAt: new Date(), nextRunAt: next },
  });
  enqueue(job.id);
}
