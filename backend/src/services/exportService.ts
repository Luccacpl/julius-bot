import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { config } from "../config.js";
import { STORES } from "../types.js";
import { listRawProducts, listRows, type CatalogFilters, type CatalogRow } from "./queryService.js";

export async function exportCatalog(kind: "catalog" | "comparison", format: "csv" | "xlsx", filters: CatalogFilters) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const filename = `${kind}-${stamp}.${format}`;
  const file = path.join(config.exportsDir, filename);
  await mkdir(config.exportsDir, { recursive: true });

  if (kind === "comparison") {
    const rows = await listRows(filters);
    const records = rows.map(comparisonRecord);
    const columns = ["Produto", "Marca", "Categoria", "Peso", ...STORES, "Menor preço", "Loja mais barata", "Status"];
    await writeTable(file, format, "Comparacao", columns, records);
    return { file, filename };
  }

  const products = await listRawProducts(filters);
  const records = products.map((product) => [
    product.store,
    product.name,
    product.brand ?? "",
    product.category ?? "",
    product.subcategory ?? "",
    product.packageSize ?? "",
    money(product.price),
    product.originalPrice != null ? money(product.originalPrice) : "",
    product.discountPercentage != null ? String(product.discountPercentage) : "",
    product.availability ?? "",
    product.productUrl,
    product.collectedAt.toISOString(),
  ]);
  const columns = ["Loja", "Produto", "Marca", "Categoria", "Subcategoria", "Peso", "Preço", "Preço original", "Desconto %", "Disponibilidade", "URL", "Coletado em"];
  await writeTable(file, format, "Catalogo", columns, records);
  return { file, filename };
}

function comparisonRecord(row: CatalogRow) {
  return [
    row.name,
    row.brand ?? "",
    row.category ?? "",
    row.packageSize ?? "",
    ...STORES.map((store) => (row.prices[store] ? money(row.prices[store].price) : "")),
    row.lowestPrice != null ? money(row.lowestPrice) : "",
    row.lowestStore ?? "",
    row.matchStatus ?? "",
  ];
}

async function writeTable(file: string, format: "csv" | "xlsx", sheet: string, columns: string[], records: string[][]) {
  if (format === "csv") {
    const lines = [columns, ...records].map((line) => line.map(csvCell).join(";"));
    await writeFile(file, `\uFEFF${lines.join("\n")}`, "utf8");
    return;
  }
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet);
  worksheet.addRow(columns);
  for (const record of records) worksheet.addRow(record);
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column) => {
    column.width = 24;
  });
  await workbook.xlsx.writeFile(file);
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
