import { AlfadermaScraper } from "./alfaderma.js";
import { CobasiScraper } from "./cobasi.js";
import { PetloveScraper } from "./petlove.js";
import { PetzScraper } from "./petz.js";
import type { Scraper, StoreName } from "../types.js";

export function createScraper(store: StoreName): Scraper {
  if (store === "Cobasi") return new CobasiScraper();
  if (store === "Petz") return new PetzScraper();
  if (store === "Petlove") return new PetloveScraper();
  return new AlfadermaScraper();
}
