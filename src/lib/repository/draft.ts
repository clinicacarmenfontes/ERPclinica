import { COMPANY } from "@/lib/company";
import type { ExtractedInvoice } from "@/lib/ai/invoice-schema";
import { normTaxId } from "@/lib/ingest/normalize";
import type { InvoiceLine, NormalizedInvoice } from "@/lib/ingest/types";
import type { RepositoryRole } from "./paths";

// Convierte la lectura de Claude en un borrador de factura normalizada y dice
// qué hay que revisar. Pura y determinista (tests/repository-draft.test.ts):
// la IA lee, pero la aritmética y las reglas las pone el código.

export type Draft = {
  invoice: NormalizedInvoice | null;
  reasons: string[];
  /** No es una factura (presupuesto, justificante de pago…): se puede descartar. */
  notAnInvoice: boolean;
};

const cents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);
const eur = (c: number) => c / 100;
const STANDARD_VAT = [0, 0.04, 0.1, 0.21];

function snapRate(rate: number): number {
  const best = STANDARD_VAT.reduce((b, r) => (Math.abs(r - rate) < Math.abs(b - rate) ? r : b), 0.21);
  return Math.abs(best - rate) < 0.006 ? best : rate;
}

export function buildDraft(x: ExtractedInvoice, role: RepositoryRole): Draft {
  const reasons: string[] = [];
  if (!["factura", "factura_rectificativa", "ticket"].includes(x.document_type)) {
    return { invoice: null, reasons: ["no_es_factura"], notAnInvoice: true };
  }

  const issuerTax = normTaxId(x.issuer_tax_id);
  const recipientTax = normTaxId(x.recipient_tax_id);
  const direction: "emitida" | "recibida" = issuerTax === COMPANY.taxId || role === "emitida" ? "emitida" : "recibida";
  if (direction === "emitida" && issuerTax !== COMPANY.taxId) reasons.push("emisor_no_es_la_clinica");
  if (direction === "recibida" && recipientTax && recipientTax !== COMPANY.taxId) reasons.push("no_dirigida_a_la_clinica");

  // Líneas: las de la lectura; si no hay, una con los totales.
  let lines: InvoiceLine[] = x.lines.map((l) => ({
    description: l.description,
    base: eur(cents(l.base)),
    vat_rate: snapRate(l.vat_rate),
    vat_amount: eur(cents(l.vat_amount)),
    vat_exempt_reason: l.vat_rate === 0 ? (x.vat_exempt_reason ?? "Exenta") : null,
    withholding_rate: l.withholding_rate,
    withholding_amount: eur(Math.abs(cents(l.withholding_amount))),
  }));
  if (lines.length === 0 && x.base_total !== null) {
    const base = cents(x.base_total);
    const vat = cents(x.vat_total);
    const wh = Math.abs(cents(x.withholding_total));
    lines = [
      {
        description: null,
        base: eur(base),
        vat_rate: base ? snapRate(vat / base) : 0,
        vat_amount: eur(vat),
        vat_exempt_reason: vat === 0 ? (x.vat_exempt_reason ?? "Exenta") : null,
        withholding_rate: base ? Math.round((wh / base) * 100) / 100 : 0,
        withholding_amount: eur(wh),
      },
    ];
  }

  const base = lines.reduce((s, l) => s + cents(l.base), 0);
  const vat = lines.reduce((s, l) => s + cents(l.vat_amount), 0);
  const wh = lines.reduce((s, l) => s + cents(l.withholding_amount ?? 0), 0);
  const total = base + vat - wh;

  if (x.total !== null && Math.abs(cents(x.total) - total) > 1) reasons.push("ia_no_cuadra");
  if (x.base_total !== null && Math.abs(cents(x.base_total) - base) > 1) reasons.push("ia_no_cuadra");
  for (const l of lines) {
    if (l.vat_rate > 0 && Math.abs(Math.round(cents(l.base) * l.vat_rate) - cents(l.vat_amount)) > 2) reasons.push("iva_no_cuadra");
  }
  if (role === "profesional" && wh === 0) reasons.push("profesional_sin_retencion");
  if (x.confidence < 0.8) reasons.push("ia_baja_confianza");
  if (!issuerTax) reasons.push("sin_nif");
  if (!x.invoice_number) reasons.push("sin_numero");
  const date = x.issue_date && /^\d{4}-\d{2}-\d{2}$/.test(x.issue_date) ? x.issue_date : null;
  if (!date) reasons.push("sin_fecha");

  if (!date || !x.issuer_name || lines.length === 0) {
    return { invoice: null, reasons: [...new Set([...reasons, "lectura_incompleta"])], notAnInvoice: false };
  }

  const number = x.invoice_number?.trim() || `SN-${date.replace(/-/g, "")}-${eur(total).toFixed(2)}`;
  const invoice: NormalizedInvoice = {
    direction,
    issuer_tax_id: direction === "emitida" ? COMPANY.taxId : issuerTax,
    issuer_name: direction === "emitida" ? COMPANY.legalName : x.issuer_name.trim(),
    invoice_number: number,
    issue_date: date,
    counterparty:
      direction === "emitida"
        ? { kind: "cliente", tax_id: recipientTax, name: x.recipient_name?.trim() || recipientTax || "Cliente" }
        : { kind: role === "profesional" ? "profesional" : "proveedor", tax_id: issuerTax, name: x.issuer_name.trim() },
    base_total: eur(base),
    vat_total: eur(vat),
    withholding_total: eur(wh),
    total: eur(total),
    // Profesionales y emitidas: se cobran/pagan por transferencia después;
    // la conciliación bancaria marcará el pago.
    status: "pendiente",
    paid_at: null,
    due_date: x.due_date && /^\d{4}-\d{2}-\d{2}$/.test(x.due_date) ? x.due_date : null,
    payment_method: x.payment_method,
    expense_type: role === "profesional" ? "Prestación servicios profesionales" : null,
    source: role === "profesional" ? "pdf_profesional" : role === "emitida" ? "pdf_emitida" : "manual",
    notes: x.notes,
    review_reasons: [...new Set(reasons)],
    lines,
  };
  return { invoice, reasons: invoice.review_reasons, notAnInvoice: false };
}
