import { createHash } from "node:crypto";
import { issuerKey, normInvoiceNumber } from "./normalize";

/**
 * Misma huella que public.invoice_dedup_hash() en SQL:
 * SHA-256 de "emisor|Nº normalizado|AAAA-MM-DD|total con 2 decimales".
 * La BBDD es quien la fija (trigger); aquí sirve para precomprobar y para tests.
 */
export function invoiceDedupHash(input: {
  issuerTaxId: string | null;
  issuerName: string;
  invoiceNumber: string;
  issueDate: string;
  totalCents: number;
}): string {
  const total = (input.totalCents / 100).toFixed(2);
  const canonical = [
    issuerKey(input.issuerTaxId, input.issuerName),
    normInvoiceNumber(input.invoiceNumber),
    input.issueDate,
    total,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
