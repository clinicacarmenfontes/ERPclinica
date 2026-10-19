import { COMPANY } from "@/lib/company";
import {
  centsToNumber,
  cleanText,
  dateRange,
  issuerKey,
  normHeader,
  normInvoiceNumber,
  normTaxId,
  parseEsAmountCents,
  parseEsDate,
} from "../normalize";
import { DocumentFormatError, type BalanceLine, type InvoiceLine, type NormalizedInvoice, type ParsedDocument } from "../types";
import type { Table, TableRow, TableSpec } from "./optimydent-table";
import type { XlsxCell } from "./xlsx";

// Port de contabilidad/optimydent.py + agrupación de líneas por factura.
// Los parsers reciben la tabla ya leída, del Excel (formato recomendado: el
// PDF corta las columnas que no caben en el A4) o del PDF.

// Solo se leen las columnas que acaban en BBDD; cualquier otra que se haya
// marcado al exportar (email, teléfono…) se ignora.
//   · Obligatorias: las que necesita la contabilidad. Identifican la factura
//     (emisor, nº, fecha, total → huella antiduplicados) o fijan datos que ya
//     no se pueden cambiar una vez dada de alta (importes, IVA, cuenta, cobro).
//   · Secundarias: si faltan se avisa y se dejan vacías. Volver a subir el
//     listado con ellas completa SOLO esos datos (fn_fill_invoice_gaps).
const DATE_ANCHOR = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

// El nº de historia no se lee: no sirve para la contabilidad.
export const SPEC_SALDOS: TableSpec = {
  columns: ["nombre", "documento de identificacion", "telefono", "codigo postal", "saldo"],
  // Sin documento, el paciente se identificaría por el nombre y se duplicaría.
  required: ["nombre", "documento de identificacion", "saldo"],
  anchorColumn: "saldo",
  anchorRe: /^[+-]?[\d.]+,\d{2}(€|EUR)?$/,
};
export const SPEC_EMITIDAS: TableSpec = {
  columns: [
    "fecha factura", "numero", "doc ident paciente", "razon social", "doc ident",
    "codigo postal", "base imponible", "impuestos", "total", "forma de pago", "fecha de pago",
  ],
  required: [
    "fecha factura", "numero", "razon social", ["doc ident paciente", "doc ident"],
    "base imponible", "impuestos", "total", "fecha de pago",
  ],
  anchorColumn: "fecha factura",
  anchorRe: DATE_ANCHOR,
};
export const SPEC_GASTOS: TableSpec = {
  columns: [
    "proveedor", "razon social", "cif", "tipo de gasto", "forma de pago", "fecha", "concepto",
    "cantidad", "impuestos", "tipo de impuesto", "factura", "asiento contable",
  ],
  // La cuenta sale del tipo de gasto ("asiento contable" llega cortado por el
  // borde del A4) y las líneas no se pueden cambiar después: ambos obligatorios.
  required: ["razon social", "cif", "fecha", "factura", "cantidad", "impuestos", "tipo de impuesto", "tipo de gasto"],
  anchorColumn: "fecha",
  anchorRe: DATE_ANCHOR,
};

/** Reconoce el Excel por su cabecera (no trae título). */
export function detectOptimydentSheetKind(sheet: XlsxCell[][]): "gastos" | "emitidas" | "saldos" | null {
  const header = new Set((sheet[0] ?? []).map((c) => normHeader(String(c ?? ""))));
  if (header.has("fecha factura")) return "emitidas";
  if (header.has("cif") || header.has("tipo de gasto") || header.has("proveedor")) return "gastos";
  if (header.has("saldo")) return "saldos";
  return null;
}

/** Reconoce el PDF por el título de la primera página ("Gastos | Optimydent"…). */
export function detectOptimydentKind(title: string): "gastos" | "emitidas" | "saldos" | null {
  if (!/Optimydent/i.test(title)) return null;
  if (/Facturas emitidas/i.test(title)) return "emitidas";
  if (/^\s*Gastos/i.test(title)) return "gastos";
  if (/Pacientes/i.test(title)) return "saldos";
  return null;
}

/** Texto de la celda (un número del Excel se pasa a texto tal cual: 46018). */
function cell(row: TableRow, col: string): string {
  const v = row.cells[col] ?? "";
  return typeof v === "number" ? String(v) : v;
}

/** Importe en céntimos: número del Excel o texto '1.477,69 €' del PDF. */
function amount(row: TableRow, col: string): number {
  const v = row.cells[col] ?? "";
  try {
    if (typeof v === "number") return Math.round(v * 100);
    const c = parseEsAmountCents(v);
    if (c === null) throw new Error("vacío");
    return c;
  } catch {
    throw new DocumentFormatError(`${row.where}: importe no válido en «${col}»: «${v}».`);
  }
}

/** Fecha ISO: 'AAAA-MM-DD' o nº de serie del Excel, o 'DD/MM/AAAA' del PDF. */
function date(row: TableRow, col: string, required = true): string | null {
  const v = row.cells[col] ?? "";
  try {
    let d: string | null;
    if (typeof v === "number") {
      // Nº de serie de Excel: días desde 1899-12-30.
      d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
    } else {
      const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v.trim());
      d = parseEsDate(iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : v);
    }
    if (required && !d) throw new Error("vacía");
    return d;
  } catch {
    throw new DocumentFormatError(`${row.where}: fecha no válida en «${col}»: «${v}».`);
  }
}

/**
 * "IVA 21%(21,00%)" → 0.21 · "Exento(0,00%)" → 0 · "IVA 10%" → 0.1 · 0.21 / 21
 * (celda numérica del Excel) → 0.21. null si no se reconoce.
 */
export function vatRateFromLabel(label: string | number): number | null {
  if (typeof label === "number") return label > 1 ? label / 100 : label;
  const m = /\((\d+),(\d{2})%\)/.exec(label) ?? /(\d+)(?:[.,](\d+))?\s*%/.exec(label);
  if (m) return Number(`${m[1]}.${m[2] ?? "0"}`) / 100;
  return /exent/i.test(label) ? 0 : null;
}

/** Tipo de IVA estándar más cercano a impuestos/base (para facturas emitidas). */
function inferVatRate(baseCents: number, vatCents: number): number {
  if (vatCents === 0 || baseCents === 0) return 0;
  const raw = vatCents / baseCents;
  return [0.04, 0.1, 0.21].reduce((best, r) => (Math.abs(r - raw) < Math.abs(best - raw) ? r : best), 0.21);
}

// ── Gastos ──────────────────────────────────────────────────────────────────

type GastoRow = {
  date: string;
  number: string;
  taxId: string | null;
  supplier: string;
  legalName: string;
  expenseType: string;
  paymentMethod: string;
  concept: string;
  totalCents: number;
  vatCents: number;
  vatLabel: string;
  vatRate: number | null;
  account: string | null;
};

export function parseGastos(table: Table): ParsedDocument {
  const warnings = [...table.warnings];
  const rows: GastoRow[] = table.rows.map((r) => {
    const supplier = cleanText(cell(r, "proveedor"));
    const account = cleanText(cell(r, "asiento contable"));
    return {
      date: date(r, "fecha")!,
      number: cleanText(cell(r, "factura")),
      taxId: normTaxId(cell(r, "cif")),
      supplier,
      legalName: cleanText(cell(r, "razon social")) || supplier,
      expenseType: cleanText(cell(r, "tipo de gasto")),
      paymentMethod: cleanText(cell(r, "forma de pago")),
      concept: cleanText(cell(r, "concepto")),
      totalCents: amount(r, "cantidad"),
      vatCents: amount(r, "impuestos"),
      vatLabel: cleanText(cell(r, "tipo de impuesto")),
      vatRate: vatRateFromLabel(r.cells["tipo de impuesto"] ?? ""),
      account: /^\d{8}$/.test(account) ? account : null,
    };
  });

  // Optimydent exporta una factura con varios tipos de IVA como varias filas:
  // se agrupan por emisor + nº + fecha en UNA factura con N líneas.
  const groups = new Map<string, GastoRow[]>();
  for (const row of rows) {
    const num = row.number ? normInvoiceNumber(row.number) : `SN:${row.totalCents}`;
    const key = `${issuerKey(row.taxId, row.legalName)}|${num}|${row.date}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const invoices: NormalizedInvoice[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const reasons: string[] = [];
    const notes: string[] = [];
    const totalCents = group.reduce((s, r) => s + r.totalCents, 0);
    const vatCents = group.reduce((s, r) => s + r.vatCents, 0);

    let number = first.number;
    if (!number) {
      number = `SN-${first.date.replace(/-/g, "")}-${(totalCents / 100).toFixed(2)}`;
      reasons.push("sin_numero");
    }
    if (!first.taxId) reasons.push("sin_nif");
    // Error habitual de alta en Optimydent: el proveedor grabado con el CIF de
    // la propia clínica (p. ej. DentalMonitoring en 3T2026).
    if (first.taxId === COMPANY.taxId) {
      reasons.push("nif_emisor_es_la_clinica");
      notes.push("El CIF del proveedor es el de la clínica: corrígelo en la ficha del proveedor en Optimydent.");
    }
    const types = new Set(group.map((r) => r.expenseType).filter(Boolean));
    if (types.size > 1) {
      reasons.push("tipos_distintos_en_factura");
      notes.push(`Optimydent asigna varios tipos de gasto: ${[...types].join(", ")}.`);
    }
    const seen = new Set<string>();
    for (const r of group) {
      const sig = `${r.totalCents}|${r.vatCents}|${r.vatLabel}`;
      if (seen.has(sig)) {
        reasons.push("linea_repetida_en_origen");
        notes.push("Hay dos líneas idénticas en Optimydent: comprueba si es un duplicado.");
        break;
      }
      seen.add(sig);
    }

    const lines: InvoiceLine[] = group.map((r) => {
      const baseCents = r.totalCents - r.vatCents;
      const rate = r.vatRate ?? inferVatRate(baseCents, r.vatCents);
      if (r.vatRate !== null && Math.abs(Math.round(baseCents * r.vatRate) - r.vatCents) > 2) {
        reasons.push("iva_no_cuadra");
        warnings.push(
          `${first.legalName} ${number}: IVA ${(r.vatCents / 100).toFixed(2)} € no es el ${Math.round(r.vatRate * 100)} % de ${(baseCents / 100).toFixed(2)} €.`,
        );
      }
      return {
        description: r.concept || null,
        base: centsToNumber(baseCents),
        vat_rate: rate,
        vat_amount: centsToNumber(r.vatCents),
        vat_exempt_reason: rate === 0 ? r.vatLabel || "Exento" : null,
        account_code: r.account,
      };
    });

    invoices.push({
      direction: "recibida",
      issuer_tax_id: first.taxId,
      issuer_name: first.legalName,
      invoice_number: number,
      issue_date: first.date,
      counterparty: { kind: "proveedor", tax_id: first.taxId, name: first.legalName },
      base_total: centsToNumber(totalCents - vatCents),
      vat_total: centsToNumber(vatCents),
      withholding_total: 0,
      total: centsToNumber(totalCents),
      // Optimydent registra el gasto cuando se paga; la conciliación trimestral
      // con el banco lo confirma.
      status: "pagada",
      paid_at: first.date,
      payment_method: first.paymentMethod || null,
      expense_type: first.expenseType || null,
      source: "optimydent",
      notes: notes.length ? notes.join(" ") : null,
      review_reasons: [...new Set(reasons)],
      lines,
    });
  }

  const [from, to] = dateRange(rows.map((r) => r.date));
  return {
    kind: "optimydent_gastos",
    summary: `Gastos de Optimydent · ${rows.length} líneas → ${invoices.length} facturas · ${table.origin}`,
    warnings,
    missingColumns: table.missing,
    coversFrom: from,
    coversTo: to,
    invoices,
    sourceRows: rows.length,
  };
}

// ── Facturas emitidas (pacientes) ───────────────────────────────────────────

export function parseEmitidas(table: Table): ParsedDocument {
  const warnings = [...table.warnings];
  const byNumber = new Map<string, NormalizedInvoice>();
  const dates: string[] = [];

  for (const r of table.rows) {
    const issueDate = date(r, "fecha factura")!;
    dates.push(issueDate);
    const number = cleanText(cell(r, "numero"));
    if (!number) throw new DocumentFormatError(`${r.where}: factura emitida sin número.`);
    const baseCents = amount(r, "base imponible");
    const vatCents = amount(r, "impuestos");
    const totalCents = amount(r, "total");
    if (baseCents + vatCents !== totalCents) {
      throw new DocumentFormatError(`${r.where}: ${number} base + impuestos ≠ total.`);
    }
    const docPatient = normTaxId(cell(r, "doc ident paciente"));
    const docInvoice = normTaxId(cell(r, "doc ident"));
    const notes: string[] = [];
    let doc = docPatient;
    if (!docPatient && docInvoice) {
      doc = docInvoice;
      notes.push("Sin documento de paciente: se usa el de la factura.");
    } else if (docPatient && docInvoice && docPatient !== docInvoice) {
      notes.push(`Documento del paciente (${docPatient}) distinto al de facturación (${docInvoice}).`);
    }
    const paidAt = date(r, "fecha de pago", false);
    const rate = inferVatRate(baseCents, vatCents);
    const line: InvoiceLine = {
      base: centsToNumber(baseCents),
      vat_rate: rate,
      vat_amount: centsToNumber(vatCents),
      vat_exempt_reason: vatCents === 0 ? "Exenta art. 20.Uno.3º LIVA (asistencia sanitaria)" : null,
    };
    const postal = cleanText(cell(r, "codigo postal"));

    const existing = byNumber.get(normInvoiceNumber(number));
    if (existing) {
      // Misma factura en dos filas (varios tipos de IVA): se suman como líneas.
      if (existing.issue_date !== issueDate) {
        throw new DocumentFormatError(`La factura ${number} aparece con dos fechas distintas.`);
      }
      existing.lines.push(line);
      existing.base_total = round2(existing.base_total + line.base);
      existing.vat_total = round2(existing.vat_total + line.vat_amount);
      existing.total = round2(existing.total + centsToNumber(totalCents));
      continue;
    }
    byNumber.set(normInvoiceNumber(number), {
      direction: "emitida",
      issuer_tax_id: COMPANY.taxId,
      issuer_name: COMPANY.legalName,
      invoice_number: number,
      issue_date: issueDate,
      bill_to: {
        name: cleanText(cell(r, "razon social")) || doc || "",
        tax_id: doc,
        postal_code: /^\d{5}$/.test(postal) ? postal : null,
      },
      counterparty: {
        kind: "paciente",
        tax_id: doc,
        name: cleanText(cell(r, "razon social")) || doc || "",
        postal_code: /^\d{5}$/.test(postal) ? postal : null,
      },
      base_total: centsToNumber(baseCents),
      vat_total: centsToNumber(vatCents),
      withholding_total: 0,
      total: centsToNumber(totalCents),
      status: paidAt ? "pagada" : "pendiente",
      paid_at: paidAt,
      payment_method: cleanText(cell(r, "forma de pago")) || null,
      source: "optimydent",
      notes: notes.length ? notes.join(" ") : null,
      review_reasons: doc ? [] : ["sin_nif"],
      lines: [line],
    });
  }

  const invoices = [...byNumber.values()];
  const [from, to] = dateRange(dates);
  return {
    kind: "optimydent_facturas_emitidas",
    summary: `Facturas emitidas de Optimydent · ${invoices.length} facturas · ${table.origin}`,
    warnings,
    missingColumns: table.missing,
    coversFrom: from,
    coversTo: to,
    invoices,
    sourceRows: table.rows.length,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Saldos de pacientes ─────────────────────────────────────────────────────

export function parseSaldos(table: Table, asOf: string): ParsedDocument {
  const lines: BalanceLine[] = table.rows.map((r) => {
    const phone = cell(r, "telefono").replace(/\D/g, "");
    const postal = cleanText(cell(r, "codigo postal"));
    return {
      tax_id: normTaxId(cell(r, "documento de identificacion")),
      name: cleanText(cell(r, "nombre")),
      phone: phone || null,
      postal_code: /^\d{5}$/.test(postal) ? postal : null,
      balance: centsToNumber(amount(r, "saldo")),
    };
  });
  const values = lines.map((l) => l.balance).filter((b) => b !== 0);
  let side: "acreedores" | "deudores";
  if (values.length > 0 && values.every((v) => v > 0)) side = "acreedores";
  else if (values.length > 0 && values.every((v) => v < 0)) side = "deudores";
  else {
    throw new DocumentFormatError(
      "El listado de pacientes mezcla saldos positivos y negativos. Exporta acreedores y deudores por separado.",
    );
  }
  const total = round2(values.reduce((s, v) => s + v, 0));
  const common = {
    asOf,
    summary: `Saldos ${side} de Optimydent · ${lines.length} pacientes · total ${total.toFixed(2)} €`,
    warnings: table.warnings,
    missingColumns: table.missing,
    coversFrom: asOf,
    coversTo: asOf,
    lines,
  };
  return side === "acreedores"
    ? { ...common, kind: "optimydent_saldos_acreedores", side }
    : { ...common, kind: "optimydent_saldos_deudores", side };
}

