import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export async function readCache<T>(key: string, ttlMs: number): Promise<T | null> {
  const file = path.join(config.cacheDir, `${key}.json`);
  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs > ttlMs) return null;
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown) {
  await mkdir(config.cacheDir, { recursive: true });
  await writeFile(path.join(config.cacheDir, `${key}.json`), JSON.stringify(value), "utf8");
}
