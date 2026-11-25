import assert from "node:assert/strict";
import { compareFingerprints, extractMeasures, fingerprintOf } from "./fingerprint.js";

const dog10 = fingerprintOf({
  name: "Ração Golden Formula Cães Adultos Frango e Arroz 10 kg",
  brand: "Golden",
  species: "Cachorro",
  category: "Ração",
  packageSize: "10 kg",
});
const dog15 = fingerprintOf({
  name: "Ração Golden Formula para Cães Adultos Sabor Frango e Arroz 15kg",
  brand: "Golden",
  species: "Cachorro",
  category: "Ração Seca",
  packageSize: "15 kg",
});
const cat = fingerprintOf({
  name: "Ração Golden Gatos Adultos Frango 10 kg",
  brand: "Golden",
  species: "Gatos",
  category: "Ração",
  packageSize: "10 kg",
});
const beef = fingerprintOf({
  name: "Ração Golden Formula Cães Adultos Carne 10 kg",
  brand: "Golden",
  species: "Cachorro",
  category: "Ração",
  packageSize: "10 kg",
});
const same = fingerprintOf({
  name: "Ração Golden Formula para Cães Adultos Frango e Arroz 10kg",
  brand: "Golden",
  species: "Cachorro",
  category: "Ração Seca",
});
const doseLow = fingerprintOf({
  name: "Antipulgas Bravecto Cães 10 mg",
  brand: "Bravecto",
  species: "Cachorro",
  packageSize: "1 comprimido",
});
const doseHigh = fingerprintOf({
  name: "Antipulgas Bravecto Cães 20 mg",
  brand: "Bravecto",
  species: "Cachorro",
  packageSize: "1 comprimido",
});

assert.equal(extractMeasures("10,1 kg").grams, 10100);
assert.equal(extractMeasures("Leve 16,5 kg Pague 15 kg").grams, 16500);
assert.equal(extractMeasures("12 Kilos").grams, 12000);
assert.equal(extractMeasures("500 ml").milliliters, 500);
assert.equal(compareFingerprints(dog10, dog15).ok, false, "embalagens diferentes não são equivalentes");
assert.equal(compareFingerprints(dog10, cat).ok, false, "cão e gato não são equivalentes");
assert.equal(compareFingerprints(dog10, beef).ok, false, "sabores diferentes não são equivalentes");
assert.equal(compareFingerprints(doseLow, doseHigh).ok, false, "dosagens diferentes não são equivalentes");
const equivalent = compareFingerprints(dog10, same);
assert.equal(equivalent.ok, true, "mesmo produto em outra loja deve casar");
assert.equal(equivalent.auto, true);

console.log("Correspondências de teste aprovadas.");
