import { cleanPackageSize, fold } from "../utils/text.js";

const STOPWORDS = new Set([
  "para", "de", "do", "da", "dos", "das", "com", "em", "e", "o", "a", "os", "as",
  "um", "uma", "pet", "produto", "racao", "seca", "umida", "sache",
  "caes", "cao", "cachorro", "cachorros", "gato", "gatos", "felino",
  "premium", "super", "special", "adulto", "adultos", "filhote", "filhotes",
  "senior", "castrado", "castrados", "porte", "pequeno", "medio", "grande",
  "mini", "max", "plus", "pro",
]);

const FLAVORS = [
  "frango", "carne", "salmao", "atum", "peru", "cordeiro", "peixe", "figado",
  "pato", "bacalhau", "chocolate", "baunilha", "queijo", "banana", "maca",
  "cenoura", "arroz", "carneiro", "leite", "presunto", "bacon", "vanilla",
];

const SPECIES_RULES: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "cao", patterns: [/\bcachorro\b/, /\bcaes\b/, /\bcao\b/] },
  { key: "gato", patterns: [/\bgatos?\b/, /\bfelino\b/] },
  { key: "ave", patterns: [/\bpassar(?:o|os|inho|inhos)\b/, /\baves?\b/] },
  { key: "peixe", patterns: [/\bpeixes?\b/] },
  { key: "roedor", patterns: [/\broedores?\b/, /\bhamster\b/, /\bcoelho\b/, /\bporquinho\b/] },
];

export interface Fingerprint {
  brandKey: string;
  species: string | null;
  speciesConflict: boolean;
  grams: number | null;
  milliliters: number | null;
  count: number | null;
  dosageMg: number[];
  flavors: string[];
  tokens: string[];
  sizeLabel: string | null;
}

export interface MatchDecision {
  ok: boolean;
  score: number;
  auto: boolean;
}

function resolveSpecies(values: string[]) {
  const unique = [...new Set(values)];
  const dogsAndCats = unique.length === 2 && unique.includes("cao") && unique.includes("gato");
  if (unique.length === 1) return { species: unique[0], speciesConflict: false };
  if (dogsAndCats) return { species: "ambos", speciesConflict: false };
  return { species: null, speciesConflict: unique.length > 1 };
}

function detectSpecies(value: string | undefined) {
  if (!value) return null;
  const text = fold(value);
  const found = SPECIES_RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(text))).map((rule) => rule.key);
  return [...new Set(found)];
}

function toNumber(raw: string) {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

export function extractMeasures(value: string) {
  const text = fold(value);
  let grams: number | null = null;
  let milliliters: number | null = null;
  let count: number | null = null;
  const dosageMg: number[] = [];
  const pattern = /(\d+(?:[.,]\d+)?)\s*(kilos?|quilos?|kg|mg|g|ml|litros?|l|unidades?|unids?|und|un|comprimidos?|capsulas?|saches?|tabletes?)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const amount = toNumber(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (unit === "mg") {
      dosageMg.push(Math.round(amount * 1000) / 1000);
      continue;
    }
    if (unit === "kg" || unit.startsWith("kilo") || unit.startsWith("quilo")) {
      if (grams == null) grams = Math.round(amount * 1000);
    } else if (unit === "g") {
      if (grams == null) grams = Math.round(amount);
    } else if (unit === "ml") {
      if (milliliters == null) milliliters = Math.round(amount);
    } else if (unit === "l" || unit.startsWith("litro")) {
      if (milliliters == null) milliliters = Math.round(amount * 1000);
    } else if (count == null) {
      count = Math.round(amount);
    }
  }
  return { grams, milliliters, count, dosageMg: [...new Set(dosageMg)] };
}

function detectFlavors(value: string) {
  const text = fold(value);
  return FLAVORS.filter((flavor) => new RegExp(`\\b${flavor}\\b`).test(text));
}

export function fingerprintOf(input: {
  name: string;
  brand?: string | null;
  species?: string | null;
  category?: string | null;
  packageSize?: string | null;
  flavor?: string | null;
}): Fingerprint {
  const brand = fold(input.brand || "");
  const speciesFromField = detectSpecies([input.species, input.category].filter(Boolean).join(" "));
  const speciesFromName = detectSpecies(input.name);
  const speciesValues = resolveSpecies([...(speciesFromField ?? []), ...(speciesFromName ?? [])]);
  const measures = extractMeasures(`${input.packageSize || ""} ${input.name}`);
  const flavors = [...new Set([...detectFlavors(input.name), ...detectFlavors(input.flavor || ""), ...detectFlavors(input.packageSize || "")])];
  let core = fold(input.name);
  if (brand) core = core.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ");
  core = core.replace(/(\d+(?:[.,]\d+)?)\s*(kilos?|quilos?|kg|mg|g|ml|litros?|l|unidades?|unids?|und|un|comprimidos?|capsulas?|saches?|tabletes?)\b/gi, " ");
  const tokens = [...new Set(core.split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !STOPWORDS.has(token) && !FLAVORS.includes(token)))];
  const sizeLabel = cleanPackageSize(input.packageSize || undefined) ?? sizeLabelFromMeasures(measures);
  return {
    brandKey: brand.replace(/[^a-z0-9]+/g, ""),
    species: speciesValues.species,
    speciesConflict: speciesValues.speciesConflict,
    grams: measures.grams,
    milliliters: measures.milliliters,
    count: measures.count,
    dosageMg: measures.dosageMg,
    flavors,
    tokens,
    sizeLabel: sizeLabel ?? null,
  };
}

export function packageSizeFromText(value: string | undefined) {
  if (!value) return undefined;
  return sizeLabelFromMeasures(extractMeasures(value)) ?? undefined;
}

function sizeLabelFromMeasures(measures: { grams: number | null; milliliters: number | null; count: number | null }) {
  if (measures.grams != null) {
    if (measures.grams >= 1000 && measures.grams % 100 === 0) {
      const kilos = measures.grams / 1000;
      return `${Number.isInteger(kilos) ? kilos : kilos.toLocaleString("pt-BR")} kg`;
    }
    return `${measures.grams} g`;
  }
  if (measures.milliliters != null) return measures.milliliters >= 1000 ? `${measures.milliliters / 1000} L` : `${measures.milliliters} ml`;
  if (measures.count != null) return `${measures.count} un`;
  return null;
}

function sameOptional(left: number | null, right: number | null) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left === right;
}

function jaccard(left: string[], right: string[]) {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return { score: union === 0 ? 0 : intersection / union, shared: intersection };
}

export function compareFingerprints(left: Fingerprint, right: Fingerprint): MatchDecision {
  if (left.speciesConflict || right.speciesConflict) return { ok: false, score: 0, auto: false };
  if (left.species && right.species && left.species !== right.species) return { ok: false, score: 0, auto: false };
  if (!left.brandKey || !right.brandKey || left.brandKey !== right.brandKey) return { ok: false, score: 0, auto: false };
  if (!sameOptional(left.grams, right.grams)) return { ok: false, score: 0, auto: false };
  if (!sameOptional(left.milliliters, right.milliliters)) return { ok: false, score: 0, auto: false };
  if (!sameOptional(left.count, right.count)) return { ok: false, score: 0, auto: false };
  if (left.dosageMg.length && right.dosageMg.length) {
    const sameDose = left.dosageMg.length === right.dosageMg.length && left.dosageMg.every((dose) => right.dosageMg.includes(dose));
    if (!sameDose) return { ok: false, score: 0, auto: false };
  }
  if (left.flavors.length && right.flavors.length && !sameList(left.flavors, right.flavors)) {
    return { ok: false, score: 0, auto: false };
  }

  const similarity = jaccard(left.tokens, right.tokens);
  const hasSize = left.grams != null || left.milliliters != null || left.count != null;
  const speciesKnown = Boolean(left.species && right.species);
  if (similarity.shared < 2 && similarity.score < 1) return { ok: false, score: similarity.score, auto: false };
  if (similarity.score < 0.78) return { ok: false, score: similarity.score, auto: false };
  const auto = similarity.score >= 0.92 && hasSize && speciesKnown && flavorsCompatible(left, right);
  return { ok: true, score: Math.round(similarity.score * 1000) / 1000, auto };
}

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function flavorsCompatible(left: Fingerprint, right: Fingerprint) {
  if (!left.flavors.length || !right.flavors.length) return false;
  return sameList(left.flavors, right.flavors);
}

export function normalizeEan(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}
