// Documento normalizado: lo que producen TODOS los canales (ficheros de
// Optimydent, RPA, repositorio, bancos) y consumen las funciones SQL de ingesta.
// Los importes viajan en euros con 2 decimales (number); los parsers trabajan
// internamente en céntimos para que las sumas sean exactas.

export type InvoiceLine = {
  description?: string | null;
  base: number;
  vat_rate: number;
  vat_amount: number;
  vat_exempt_reason?: string | null;
  withholding_rate?: number;
  withholding_amount?: number;
  account_code?: string | null;
};

export type NormalizedInvoice = {
  direction: "emitida" | "recibida";
  issuer_tax_id: string | null;
  issuer_name: string;
  invoice_number: string;
  issue_date: string;
  counterparty?: {
    kind: "paciente" | "proveedor" | "profesional" | "cliente";
    tax_id: string | null;
    name: string;
    clinical_record?: string | null;
    postal_code?: string | null;
  };
  base_total: number;
  vat_total: number;
  withholding_total: number;
  total: number;
  status: "pendiente" | "parcial" | "pagada";
  paid_amount?: number;
  paid_at: string | null;
  due_date?: string | null;
  payment_method: string | null;
  expense_type?: string | null;
  source: "optimydent" | "pdf_profesional" | "pdf_emitida" | "manual";
  notes?: string | null;
  review_reasons: string[];
  lines: InvoiceLine[];
};

export type BankTransaction = {
  booking_date: string;
  value_date: string | null;
  amount: number;
  balance_after: number | null;
  description: string;
  ordinal: number;
};

export type BalanceLine = {
  tax_id: string | null;
  name: string;
  phone: string | null;
  postal_code: string | null;
  balance: number;
};

type Common = {
  /** Texto para la pantalla: "Gastos de Optimydent · 212 líneas · 12 páginas". */
  summary: string;
  warnings: string[];
  /** Columnas secundarias que no venían en el listado (se dejan vacías). */
  missingColumns?: string[];
  coversFrom: string | null;
  coversTo: string | null;
};

type InvoiceListing<K extends string> = Common & { kind: K; invoices: NormalizedInvoice[]; sourceRows: number };
type BalanceListing<K extends string, S extends "acreedores" | "deudores"> = Common & {
  kind: K;
  side: S;
  asOf: string;
  lines: BalanceLine[];
};

// Una variante por `kind` para que TypeScript discrimine bien la unión.
export type ParsedDocument =
  | InvoiceListing<"optimydent_gastos">
  | InvoiceListing<"optimydent_facturas_emitidas">
  | BalanceListing<"optimydent_saldos_acreedores", "acreedores">
  | BalanceListing<"optimydent_saldos_deudores", "deudores">
  | (Common & {
      kind: "movimientos_banco";
      bank: "kutxabank" | "caixabank";
      accountNumber: string | null;
      transactions: BankTransaction[];
    });

export type DocumentKind = ParsedDocument["kind"];

/** El fichero no tiene el formato esperado: se rechaza entero, nunca a medias. */
export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentFormatError";
  }
}
