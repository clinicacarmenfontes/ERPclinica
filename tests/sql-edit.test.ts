import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";

type Row = Record<string, unknown>;

let db: PGlite;
let runId: string;

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
async function ingest(items: object[]) {
  return (await one<{ res: Row[] }>("select erp.fn_ingest_invoices($1::jsonb, $2, null) as res", [JSON.stringify(items), runId])).res;
}
const edit = (id: unknown, p: object, reason: string | null = "Corrección desde la revisión") =>
  one<{ id: string }>("select erp.fn_edit_invoice($1, $2::jsonb, $3, 'admin') as id", [id, JSON.stringify(p), reason]);

const line = { base: 500, vat_rate: 0.21, vat_amount: 105 };
const hgbs = (over: Partial<Record<string, unknown>> = {}) => ({
  direction: "recibida",
  issuer_tax_id: "B88888888",
  issuer_name: "HGBS Consourcing SL",
  invoice_number: "H-07",
  issue_date: "2026-07-01",
  base_total: 500,
  vat_total: 105,
  withholding_total: 0,
  total: 605,
  status: "pagada",
  paid_at: "2026-07-01",
  expense_type: "Alquiler Local",
  source: "optimydent",
  lines: [line],
  ...over,
});
// Optimydent exportó la factura dos veces: el parser la agrupa en UNA con dos líneas.
const hgbsDoble = () =>
  hgbs({ base_total: 1000, vat_total: 210, total: 1210, lines: [line, line], review_reasons: ["linea_repetida_en_origen"] });

const live = () =>
  db.query<{ id: string; total: number; review_reasons: string[]; issuer_tax_id: string | null }>(
    "select id, total::float as total, review_reasons, issuer_tax_id from erp.invoices where status <> 'anulada'",
  );

beforeEach(async () => {
  db = await createTestDb();
  runId = (await one<{ id: string }>("select erp.fn_start_sync_run('optimydent_fichero', 'subida_manual', 'test') as id")).id;
});

describe("línea repetida de Optimydent → dejar solo una", () => {
  it("quita la línea repetida: queda una factura con el importe correcto y sin el aviso", async () => {
    const [r] = await ingest([hgbsDoble()]);
    const { id } = await edit(r.invoice_id, { remove_lines: [2] }, "Línea duplicada en Optimydent");
    expect(id).not.toBe(r.invoice_id);
    const rows = (await live()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, total: 605, review_reasons: [] });
    const lines = await one<{ n: number }>("select count(*)::int as n from erp.invoice_lines where invoice_id = $1", [id]);
    expect(lines.n).toBe(1);

    // Optimydent aún con el duplicado → se ignora; ya corregido → es la misma.
    expect((await ingest([hgbsDoble()]))[0].result).toBe("ignorada_anulada");
    expect((await ingest([hgbs()]))[0].result).toBe("sin_cambios");
  });

  it("no deja quitar todas las líneas ni corregir sin motivo", async () => {
    const [r] = await ingest([hgbsDoble()]);
    await expect(edit(r.invoice_id, { remove_lines: [1, 2] })).rejects.toThrow(/al menos una línea/);
    await expect(edit(r.invoice_id, { remove_lines: [2] }, null)).rejects.toThrow(/motivo/);
  });
});

describe("factura anulada que bloqueaba la buena (caso HGBS)", () => {
  it("una decisión «mantener la existente» deja de aplicar si esa existente se anula", async () => {
    const [doble] = await ingest([hgbsDoble()]);
    const [c] = await ingest([hgbs()]);
    expect(c.result).toBe("conflicto");
    await db.query("select erp.fn_resolve_conflict($1, 'mantener_existente', null, 'admin')", [c.conflict_id]);
    expect((await ingest([hgbs()]))[0].result).toBe("ignorada_resuelta");

    await db.query("select erp.fn_void_invoice($1, 'Duplicada por error en Optimydent', 'admin')", [doble.invoice_id]);
    expect((await ingest([hgbs()]))[0].result).toBe("insertada");
    expect((await live()).rows.map((r) => r.total)).toEqual([605]);
  });
});

describe("corregir el campo del aviso", () => {
  it("gasto sin NIF → se añade el NIF y desaparece el aviso", async () => {
    const [r] = await ingest([hgbs({ issuer_tax_id: null, review_reasons: ["sin_nif"] })]);
    const { id } = await edit(r.invoice_id, { issuer_tax_id: "b-88888888" }, "NIF del proveedor añadido");
    expect((await live()).rows).toEqual([expect.objectContaining({ id, issuer_tax_id: "B88888888", review_reasons: [] })]);
    const p = await one("select p.tax_id from erp.invoices i join erp.parties p on p.id = i.counterparty_id where i.id = $1", [id]);
    expect(p.tax_id).toBe("B88888888");
  });

  it("emitida sin NIF del paciente → se completa su ficha, sin anular la factura", async () => {
    const [r] = await ingest([
      {
        direction: "emitida",
        issuer_tax_id: "B67717082",
        issuer_name: "Dental Fontes Lluch SLP",
        invoice_number: "P1/2026",
        issue_date: "2026-09-30",
        counterparty: { kind: "paciente", tax_id: null, name: "Paciente Sin NIF" },
        base_total: 80,
        vat_total: 0,
        total: 80,
        status: "pagada",
        paid_at: "2026-09-30",
        source: "optimydent",
        review_reasons: ["sin_nif"],
        lines: [{ base: 80, vat_rate: 0, vat_amount: 0, vat_exempt_reason: "Exenta" }],
      },
    ]);
    const { id } = await edit(r.invoice_id, { counterparty_tax_id: "11111111h" }, null);
    expect(id).toBe(r.invoice_id);
    const x = await one(
      "select i.review_reasons, i.needs_review, p.tax_id from erp.invoices i join erp.parties p on p.id = i.counterparty_id",
    );
    expect(x).toMatchObject({ review_reasons: [], needs_review: false, tax_id: "11111111H" });
  });

  it("cambiar el tipo de gasto reclasifica y cambia la cuenta de las líneas, sin motivo", async () => {
    const [r] = await ingest([hgbs({ review_reasons: ["tipos_distintos_en_factura"] })]);
    const { type } = await one<{ type: string }>("select id as type from erp.expense_types where account_code is not null and name <> 'Alquiler Local' limit 1");
    const { id } = await edit(r.invoice_id, { expense_type_id: type }, null);
    expect(id).toBe(r.invoice_id);
    const x = await one(
      `select i.expense_type_id, i.review_reasons, l.account_code, t.account_code as type_account, i.manual_fields
         from erp.invoices i join erp.invoice_lines l on l.invoice_id = i.id join erp.expense_types t on t.id = $1`,
      [type],
    );
    expect(x.expense_type_id).toBe(type);
    expect(x.review_reasons).toEqual([]);
    expect(x.account_code).toBe(x.type_account);
    expect(x.manual_fields).toContain("expense_type_id");
  });

  it("los importes de las líneas siguen siendo inmutables", async () => {
    await ingest([hgbs()]);
    await expect(db.query("update erp.invoice_lines set base = 1")).rejects.toThrow(/inmutable/);
  });
});
