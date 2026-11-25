import { prisma } from "../database/client.js";
import { executeJob } from "../jobs/runner.js";

const pending: string[] = [];
let active = false;

export function enqueue(jobId: string) {
  if (!pending.includes(jobId)) pending.push(jobId);
  void pump();
}

export function queueSize() {
  return pending.length + (active ? 1 : 0);
}

async function pump() {
  if (active) return;
  const jobId = pending.shift();
  if (!jobId) return;
  active = true;
  try {
    await executeJob(jobId);
  } finally {
    active = false;
    void pump();
  }
}

export async function recoverJobs() {
  await prisma.scrapeJob.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      message: "A coleta foi interrompida porque o servidor reiniciou.",
      finishedAt: new Date(),
    },
  });
  const queued = await prisma.scrapeJob.findMany({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
  for (const job of queued) enqueue(job.id);
}
