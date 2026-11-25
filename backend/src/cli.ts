import "dotenv/config";
import { prisma } from "./database/client.js";
import { executeJob } from "./jobs/runner.js";
import { config } from "./config.js";
import { STORES, type StoreName } from "./types.js";

const args = process.argv.slice(2);

function option(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function list(name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

const stores = list("--store").filter((store): store is StoreName => STORES.includes(store as StoreName));
const categories = list("--category");
const maxPages = option("--max-pages") ? Number(option("--max-pages")) : null;
const selected = stores.length ? stores : (["Cobasi"] as StoreName[]);
const categoryFilter = categories.length
  ? Object.fromEntries(selected.map((store) => [store, categories]))
  : null;

const job = await prisma.scrapeJob.create({
  data: {
    stores: selected.join(","),
    categoryFilter: categoryFilter ? JSON.stringify(categoryFilter) : null,
    maxPages: maxPages && maxPages > 0 ? maxPages : null,
    delayMs: config.delayMs,
    status: "queued",
  },
});

await executeJob(job.id);
const finished = await prisma.scrapeJob.findUnique({ where: { id: job.id } });
console.log(finished?.status, finished?.message);
await prisma.$disconnect();
process.exit(finished?.status === "completed" ? 0 : 1);
