import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(backendRoot, "..");

function integer(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: integer("PORT", 3333),
  delayMs: Math.max(400, integer("SCRAPE_DELAY_MS", 800)),
  browserChannel: process.env.BROWSER_CHANNEL || "msedge",
  browserHeadless: process.env.BROWSER_HEADLESS === "true",
  projectRoot,
  dataDir: path.join(backendRoot, "data"),
  cacheDir: path.join(backendRoot, "data", "cache"),
  exportsDir: path.join(projectRoot, "exports"),
  userAgent: "PetPriceMonitor/1.0 (comparador de precos pet; coleta pausada)",
};
