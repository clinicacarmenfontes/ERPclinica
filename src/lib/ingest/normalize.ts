// Normalización con paridad EXACTA con las funciones SQL de la migración 0001
// (norm_tax_id, norm_name, invoice_number_norm). Si cambias una, cambia la otra:
// tests/dedup-hash.test.ts compara ambas implementaciones.

/** '52683874 m' / 'B-67717082' → '52683874M' / 'B67717082'. null si queda vacío. */
export function normTaxId(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v === "" ? null : v;
}

/** Nombre de tercero sin NIF: espacios colapsados y en mayúsculas. */
export function normName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Clave de emisor: el NIF si lo hay; si no, 'N:' + nombre normalizado. */
export function issuerKey(taxId: string | null | undefined, name: string | null | undefined): string {
  return normTaxId(taxId) ?? `N:${normName(name)}`;
}

export function normInvoiceNumber(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}

/** Espacios colapsados (textos de celdas multilínea). */
export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

// ── Importes: siempre en céntimos enteros para no arrastrar errores de coma flotante ──

const ES_AMOUNT = /^([+-]?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/;

/**
 * '-1.290,00€' / '+480,00EUR' / '10.195,03 €' → céntimos (-129000 / 48000 / 1019503).
 * null si está vacío. Lanza si el texto no es un importe.
 */
export function parseEsAmountCents(text: string | null | undefined): number | null {
  const t = (text ?? "").replace(/\s/g, "").replace(/(€|EUR)$/i, "");
  if (t === "") return null;
  const m = ES_AMOUNT.exec(t);
  if (!m) throw new Error(`Importe no válido: «${text}»`);
  const cents = Number(m[2].replace(/\./g, "")) * 100 + Number(m[3]);
  return m[1] === "-" ? -cents : cents;
}

export function isEsAmount(text: string): boolean {
  try {
    return parseEsAmountCents(text) !== null;
  } catch {
    return false;
  }
}

export const centsToNumber = (cents: number): number => cents / 100;

// ── Fechas ──

/** '30/09/2026' → '2026-09-30'. null si vacío; lanza si no es una fecha real. */
export function parseEsDate(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (t === "") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) throw new Error(`Fecha no válida: «${text}»`);
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    throw new Error(`Fecha no válida: «${text}»`);
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const ES_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/** Rango [min, max] de fechas ISO (null si no hay). */
export function dateRange(dates: (string | null | undefined)[]): [string | null, string | null] {
  const valid = dates.filter((d): d is string => !!d).sort();
  return [valid[0] ?? null, valid[valid.length - 1] ?? null];
}

/** Texto comparable de cabeceras: minúsculas, sin tildes, solo letras y números. */
export function normHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/[º°]/g, "o")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
