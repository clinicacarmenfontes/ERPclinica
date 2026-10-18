import * as z from "zod/v4";

// Lo que Claude devuelve al leer una factura (salida estructurada). Importes en
// euros tal y como aparecen; la app los valida después con aritmética exacta.
export const extractedInvoiceSchema = z.object({
  document_type: z
    .enum(["factura", "factura_rectificativa", "ticket", "proforma_o_presupuesto", "justificante_pago", "otro"])
    .describe("Qué es el documento. Solo 'factura', 'factura_rectificativa' y 'ticket' se contabilizan."),
  issuer_name: z.string().nullable().describe("Razón social de quien EMITE la factura"),
  issuer_tax_id: z.string().nullable().describe("NIF/CIF/VAT de quien emite, sin espacios"),
  recipient_name: z.string().nullable().describe("Razón social del destinatario"),
  recipient_tax_id: z.string().nullable().describe("NIF/CIF del destinatario"),
  invoice_number: z.string().nullable().describe("Número de factura tal cual aparece"),
  issue_date: z.string().nullable().describe("Fecha de emisión en formato AAAA-MM-DD"),
  due_date: z.string().nullable().describe("Fecha de vencimiento AAAA-MM-DD si aparece"),
  lines: z
    .array(
      z.object({
        description: z.string().nullable(),
        base: z.number().describe("Base imponible de este tipo de IVA"),
        vat_rate: z.number().describe("Tipo de IVA en tanto por uno: 0.21, 0.10, 0.04 o 0"),
        vat_amount: z.number(),
        withholding_rate: z.number().describe("Retención IRPF en tanto por uno (p. ej. 0.15) o 0"),
        withholding_amount: z.number().describe("Importe de la retención, en positivo"),
      }),
    )
    .describe("Una entrada por tipo de IVA/retención (resumen fiscal de la factura), no por artículo"),
  base_total: z.number().nullable(),
  vat_total: z.number().nullable(),
  withholding_total: z.number().nullable().describe("Retención total en positivo (0 si no hay)"),
  total: z.number().nullable().describe("Total a pagar = base + IVA − retención"),
  vat_exempt_reason: z.string().nullable().describe("Motivo de exención de IVA si se indica (p. ej. art. 20 LIVA)"),
  payment_method: z.string().nullable(),
  confidence: z.number().describe("Confianza global en la lectura, de 0 a 1"),
  notes: z.string().nullable().describe("Cualquier cosa rara: ilegible, varias facturas en un documento, importes tachados…"),
});

export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;
