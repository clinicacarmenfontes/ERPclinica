import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";

let db: PGlite;
let run: string;

const gasto = (over: Record<string, unknown>) => ({
  direction: "recibida",
  issuer_tax_id: "B11111111",
  issuer_name: "Proveedor Uno SL",
  invoice_number: "X-1",
  issue_date: "2026-08-31",
  base_total: 100,
  vat_total: 21,
  total: 121,
  status: "pagada",
  source: "optimydent",
  expense_type: "Facturas de Laboratorio",
  lines: [{ base: 100, vat_rate: 0.21, vat_amount: 21 }],
  ...over,
});

async function ingest(items: object[]) {
  const r = await db.query<{ r: { invoice_id: string; result: string }[] }>(
    "select erp.fn_ingest_invoices($1::jsonb, $2, null) as r",
    [JSON.stringify(items), run],
  );
  return r.rows[0].r;
}

async function newExtraction(name: string, extracted: object = {}) {
  const doc = await db.query<{ id: string }>(
    `insert into erp.source_documents (kind, file_name, mime_type, storage_path, sha256, byte_size)
     values ('factura_recibida', $1, 'application/pdf', $1, md5($1), 1) returning id`,
    [name],
  );
  const ex = await db.query<{ id: string }>(
    "insert into erp.document_extractions (source_document_id, extracted) values ($1, $2::jsonb) returning id",
    [doc.rows[0].id, JSON.stringify(extracted)],
  );
  return { docId: doc.rows[0].id, extractionId: ex.rows[0].id };
}

const match = async (p: object) =>
  (await db.query<{ m: { id: string; score: number }[] }>("select erp.fn_match_extraction($1::jsonb) as m", [JSON.stringify(p)])).rows[0].m;

beforeEach(async () => {
  db = await createTestDb();
  run = (await db.query<{ id: string }>("select erp.fn_start_sync_run('repositorio', 'boton', 'test') as id")).rows[0].id;
});

describe("fn_match_extraction", () => {
  it("DentalMonitoring grabado en Optimydent con el CIF de la clínica: casa por nº + total + fecha", async () => {
    const [inv] = await ingest([gasto({ issuer_tax_id: "B67717082", issuer_name: "GC RE DentalMonitoring", invoice_number: "INVDMFR100707", total: 241.46, base_total: 199.55, vat_total: 41.91, lines: [{ base: 199.55, vat_rate: 0.21, vat_amount: 41.91 }] })]);
    const m = await match({ direction: "recibida", issuer_tax_id: "N0020102J", issuer_name: "DentalMonitoring SAS", invoice_number: "INVDMFR100707", issue_date: "2026-08-31", total: 241.46 });
    expect(m[0]).toMatchObject({ id: inv.invoice_id });
    expect(m[0].score).toBeGreaterThanOrEqual(0.9);
  });

  it("'177/1' en Optimydent = '177-1' en el nombre del PDF", async () => {
    const [inv] = await ingest([gasto({ invoice_number: "177/1", total: 5.78, base_total: 5.56, vat_total: 0.22, lines: [{ base: 5.56, vat_rate: 0.04, vat_amount: 0.22 }] })]);
    const m = await match({ direction: "recibida", issuer_tax_id: "B11111111", issuer_name: "Proveedor", invoice_number: "177-1", issue_date: "2026-08-31", total: 5.78 });
    expect(m[0]).toMatchObject({ id: inv.invoice_id, score: 1 });
  });

  it("sin coincidencias → lista vacía", async () => {
    await ingest([gasto({})]);
    expect(await match({ direction: "recibida", issuer_name: "Otro", invoice_number: "Z9", issue_date: "2026-01-01", total: 9.99 })).toEqual([]);
  });
});

describe("bandeja", () => {
  it("vincular como justificante y control de gastos sin PDF", async () => {
    const [a] = await ingest([gasto({})]);
    await ingest([gasto({ invoice_number: "X-2" })]);
    const { extractionId } = await newExtraction("x1.pdf");
    await db.query("select erp.fn_link_extraction($1, $2, 'sistema')", [extractionId, a.invoice_id]);
    const sin = await db.query<{ invoice_number: string }>("select invoice_number from erp.v_invoices_without_receipt");
    expect(sin.rows.map((r) => r.invoice_number)).toEqual(["X-2"]);
  });

  it("contabilizar una factura de doctora; si se vuelve a contabilizar otra copia → vinculada, no duplicada", async () => {
    const doctora = {
      direction: "recibida",
      issuer_tax_id: "12345678Z",
      issuer_name: "Doctora Ejemplo",
      invoice_number: "23/2026",
      issue_date: "2026-09-30",
      counterparty: { kind: "profesional", tax_id: "12345678Z", name: "Doctora Ejemplo" },
      base_total: 656,
      vat_total: 0,
      withholding_total: 98.4,
      total: 557.6,
      status: "pendiente",
      source: "pdf_profesional",
      expense_type: "Prestación servicios profesionales",
      lines: [{ base: 656, vat_rate: 0, vat_amount: 0, vat_exempt_reason: "art. 20", withholding_rate: 0.15, withholding_amount: 98.4 }],
    };
    const e1 = await newExtraction("doctora.pdf");
    const r1 = await db.query<{ r: { result: string } }>("select erp.fn_book_extraction($1, $2::jsonb, 'admin') as r", [e1.extractionId, JSON.stringify(doctora)]);
    expect(r1.rows[0].r.result).toBe("insertada");
    const w = await db.query<{ model: string; withholding: string }>("select model, withholding from erp.v_withholding_by_quarter");
    expect(w.rows[0]).toMatchObject({ model: "111" });
    expect(Number(w.rows[0].withholding)).toBe(98.4);

    const e2 = await newExtraction("doctora (copia).pdf");
    const r2 = await db.query<{ r: { result: string } }>("select erp.fn_book_extraction($1, $2::jsonb, 'admin') as r", [e2.extractionId, JSON.stringify(doctora)]);
    expect(r2.rows[0].r.result).toBe("sin_cambios");
    const st = await db.query<{ status: string }>("select status from erp.document_extractions order by created_at");
    expect(st.rows.map((r) => r.status)).toEqual(["contabilizado", "vinculado"]);
    const n = await db.query<{ n: number }>("select count(*)::int as n from erp.invoices");
    expect(n.rows[0].n).toBe(1);
  });

  it("descartar exige motivo y solo vale para pendientes", async () => {
    const { extractionId } = await newExtraction("presupuesto.pdf");
    await expect(db.query("select erp.fn_discard_extraction($1, '', 'admin')", [extractionId])).rejects.toThrow(/por qué/);
    await db.query("select erp.fn_discard_extraction($1, 'Es un presupuesto', 'admin')", [extractionId]);
    await expect(db.query("select erp.fn_discard_extraction($1, 'Otra vez', 'admin')", [extractionId])).rejects.toThrow(/pendientes/);
  });
});
