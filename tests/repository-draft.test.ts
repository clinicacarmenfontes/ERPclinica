import { describe, expect, it } from "vitest";
import type { ExtractedInvoice } from "@/lib/ai/invoice-schema";
import { buildDraft } from "@/lib/repository/draft";

const base: ExtractedInvoice = {
  document_type: "factura",
  issuer_name: "Doctora Ejemplo",
  issuer_tax_id: "12345678z",
  recipient_name: "Dental Fontes Lluch SLP",
  recipient_tax_id: "B-67717082",
  invoice_number: "23/2026",
  issue_date: "2026-09-30",
  due_date: null,
  lines: [{ description: "Servicios odontológicos", base: 656, vat_rate: 0, vat_amount: 0, withholding_rate: 0.15, withholding_amount: 98.4 }],
  base_total: 656,
  vat_total: 0,
  withholding_total: 98.4,
  total: 557.6,
  vat_exempt_reason: "Exenta art. 20.Uno.3º LIVA",
  payment_method: "Transferencia",
  confidence: 0.95,
  notes: null,
};

describe("buildDraft", () => {
  it("doctora con retención 15 % → recibida, profesional, total neto y sin avisos", () => {
    const d = buildDraft(base, "profesional");
    expect(d.reasons).toEqual([]);
    expect(d.invoice).toMatchObject({
      direction: "recibida",
      issuer_tax_id: "12345678Z",
      base_total: 656,
      withholding_total: 98.4,
      total: 557.6,
      source: "pdf_profesional",
      expense_type: "Prestación servicios profesionales",
      counterparty: { kind: "profesional" },
    });
  });

  it("la suma que no cuadra se marca, no se corrige en silencio", () => {
    const d = buildDraft({ ...base, total: 600 }, "profesional");
    expect(d.reasons).toContain("ia_no_cuadra");
    expect(d.invoice!.total).toBe(557.6);
  });

  it("factura de doctora sin retención → aviso", () => {
    const d = buildDraft(
      { ...base, lines: [{ ...base.lines[0], withholding_rate: 0, withholding_amount: 0 }], withholding_total: 0, total: 656 },
      "profesional",
    );
    expect(d.reasons).toContain("profesional_sin_retencion");
  });

  it("emitida por la clínica a otra clínica → emitida, contrapartida cliente", () => {
    const d = buildDraft(
      {
        ...base,
        issuer_name: "Dental Fontes Lluch SLP",
        issuer_tax_id: "B67717082",
        recipient_name: "Mario Ballesteros",
        recipient_tax_id: "26745391W",
        invoice_number: "07/2026",
        lines: [{ description: null, base: 1000, vat_rate: 0, vat_amount: 0, withholding_rate: 0, withholding_amount: 0 }],
        base_total: 1000,
        withholding_total: 0,
        total: 1000,
      },
      "emitida",
    );
    expect(d.invoice).toMatchObject({ direction: "emitida", issuer_tax_id: "B67717082", counterparty: { kind: "cliente", tax_id: "26745391W" } });
  });

  it("IVA 21 % redondeado por la IA (0.2099) se ajusta al tipo estándar; sin líneas usa los totales", () => {
    const d = buildDraft(
      { ...base, lines: [], base_total: 100, vat_total: 21, withholding_total: 0, total: 121, issuer_tax_id: "B12345678" },
      "registrada_optimydent",
    );
    expect(d.invoice!.lines).toEqual([expect.objectContaining({ base: 100, vat_rate: 0.21, vat_amount: 21 })]);
    expect(d.invoice!.source).toBe("manual");
  });

  it("justificante de pago / presupuesto → no es factura", () => {
    expect(buildDraft({ ...base, document_type: "justificante_pago" }, "profesional")).toMatchObject({ notAnInvoice: true, invoice: null });
  });

  it("baja confianza y sin NIF → para revisar", () => {
    const d = buildDraft({ ...base, confidence: 0.5, issuer_tax_id: null }, "pendiente_registrar");
    expect(d.reasons).toEqual(expect.arrayContaining(["ia_baja_confianza", "sin_nif"]));
  });
});

describe("salida estructurada", () => {
  it("el esquema de lectura se convierte a JSON Schema para Claude", async () => {
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
    const { extractedInvoiceSchema } = await import("@/lib/ai/invoice-schema");
    const f = zodOutputFormat(extractedInvoiceSchema);
    expect(f.type).toBe("json_schema");
    const props = (f.schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["issuer_tax_id", "lines", "total", "document_type"]));
  });
});
