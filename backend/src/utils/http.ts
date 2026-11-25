import { config } from "../config.js";
import { sleep } from "./sleep.js";

export interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
}

export async function fetchText(url: string, signal?: AbortSignal, attemptLimit = 3): Promise<HttpResult> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal,
        headers: {
          "user-agent": config.userAgent,
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      if (response.status === 429 || response.status >= 500) {
        await sleep(attempt * 1500, signal);
        lastError = new Error(`HTTP ${response.status} em ${url}`);
        continue;
      }
      return { status: response.status, headers: response.headers, text: await response.text() };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      await sleep(attempt * 1000, signal);
    }
  }
  throw lastError ?? new Error(`Falha ao acessar ${url}`);
}
