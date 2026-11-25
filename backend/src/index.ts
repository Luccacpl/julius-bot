import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { access } from "node:fs/promises";
import { config } from "./config.js";
import { prisma } from "./database/client.js";
import { startScheduler } from "./jobs/scheduler.js";
import { recoverJobs } from "./queues/scrapeQueue.js";
import { api } from "./routes/api.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", api);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Erro interno";
  console.error(error);
  response.status(500).json({ message });
});

const frontend = path.join(config.projectRoot, "frontend", "dist");
try {
  await access(path.join(frontend, "index.html"));
  app.use(express.static(frontend));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(path.join(frontend, "index.html"));
  });
} catch {
  // O Vite atende a interface durante o desenvolvimento.
}

await prisma.schedule.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
await recoverJobs();
startScheduler();

app.listen(config.port, () => {
  console.log(`API do monitor de preços em http://localhost:${config.port}`);
});
