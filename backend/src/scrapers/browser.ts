import { chromium, type Browser, type Page } from "playwright";
import { config } from "../config.js";
import { StoreBlockedError, type StoreName } from "../types.js";

export class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async start() {
    if (this.page) return;
    this.browser = await chromium.launch({
      channel: config.browserChannel,
      headless: config.browserHeadless,
      args: ["--window-size=1100,800"],
    });
    this.page = await this.browser.newPage({ viewport: { width: 1100, height: 800 } });
    this.page.setDefaultTimeout(45000);
  }

  async open(url: string, store: StoreName) {
    await this.start();
    const response = await this.page!.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await this.page!.waitForTimeout(1200);
    const status = response?.status() ?? 0;
    const title = await this.page!.title();
    if (status === 403 || /access denied|um momento|just a moment|verifica/i.test(title)) {
      throw new StoreBlockedError(
        store,
        "O site manteve o bloqueio mesmo com o navegador visível. A coleta desta loja foi interrompida, sem tentativa de contornar a proteção.",
      );
    }
    return this.page!;
  }

  async evaluate<T>(pageFunction: (...args: any[]) => Promise<T> | T, arg?: unknown): Promise<T> {
    if (!this.page) throw new Error("Navegador não iniciado");
    if (arg === undefined) return this.page.evaluate(pageFunction as () => Promise<T> | T);
    return this.page.evaluate(pageFunction as (value: unknown) => Promise<T> | T, arg);
  }

  async close() {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.page = null;
  }
}
