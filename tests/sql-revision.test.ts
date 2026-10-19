import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./helpers/db";

type Row = Record<string, unknown>;

let db: PGlite;
let runId: string;

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function ingest(items: object[]) {
  return (await one<{ res: Row[] }>("select erp.fn_ingest_invoices($1::jsonb, $2, null) as res", [JSON.stringify(items), runId])).res;
}

const gasto = (over: Partial<Record<string, unknown>> = {}) => ({
  direction: "recibida",
  issuer_tax_id: "B12345678",
  issuer_name: "Proveedor Nuevo SL",
  invoice_number: "N-1",
  issue_date: "2026-10-06",
  base_total: 100,
  vat_total: 21,
  withholding_total: 0,
  total: 121,
  status: "pagada",
  paid_at: "2026-10-06",
  expense_type: "Tipo Inventado",
  source: "optimydent",
  lines: [{ base: 100, vat_rate: 0.21, vat_amount: 21 }],
  ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  runId = (await one<{ id: string }>("select erp.fn_start_sync_run('optimydent_fichero', 'subida_manual', 'test') as id")).id;
});

describe("tipo de gasto nuevo → cuenta y partida", () => {
  it("fija la cuenta, completa las líneas, reclasifica y quita el motivo de revisión", async () => {
    const [r] = await ingest([gasto({ review_reasons: ["sin_nif"] })]);
    expect(r.result).toBe("insertada");
    const before = await one<{ review_reasons: string[]; account_code: string | null }>(
      "select i.review_reasons, l.account_code from erp.invoices i join erp.invoice_lines l on l.invoice_id = i.id",
    );
    expect(before.review_reasons).toContain("tipo_gasto_nuevo");
    expect(before.account_code).toBeNull();

    const { type_id } = await one<{ type_id: string }>("select id as type_id from erp.expense_types where name = 'Tipo Inventado'");
    const { cat } = await one<{ cat: string }>("select id as cat from erp.expense_categories where name = 'Clínico'");
    const { account } = await one<{ account: string }>(
      "select code as account from erp.accounts where kind = 'gasto' and active order by code limit 1",
    );
    const { n } = await one<{ n: number }>("select erp.fn_set_expense_type($1, $2, $3, 'admin') as n", [type_id, account, cat]);
    expect(n).toBe(1);

    const after = await one(
      `select i.review_reasons, i.needs_review, i.category_id, l.account_code, t.needs_review as type_review
         from erp.invoices i join erp.invoice_lines l on l.invoice_id = i.id join erp.expense_types t on t.id = i.expense_type_id`,
    );
    expect(after).toMatchObject({ review_reasons: ["sin_nif"], needs_review: true, category_id: cat, account_code: account, type_review: false });
  });

  it("rechaza una cuenta que no es de gasto", async () => {
    await ingest([gasto()]);
    const { type_id } = await one<{ type_id: string }>("select id as type_id from erp.expense_types where name = 'Tipo Inventado'");
    const { cat } = await one<{ cat: string }>("select id as cat from erp.expense_categories limit 1");
    await expect(db.query("select erp.fn_set_expense_type($1, '10000000', $2, 'admin')", [type_id, cat])).rejects.toThrow(
      /no es una cuenta de gasto/,
    );
  });

  it("la cuenta de una línea ya informada no se puede cambiar", async () => {
    await ingest([gasto({ expense_type: "Alquiler Local" })]);
    await expect(db.query("update erp.invoice_lines set account_code = '62900000'")).rejects.toThrow(/inmutable/);
  });
});

describe("cierre de trimestre", () => {
  it("cerrar bloquea altas; reabrir exige motivo y deja traza", async () => {
    await db.query("select erp.fn_close_tax_period(2026, 4, 'admin')");
    expect((await ingest([gasto()]))[0].result).toBe("periodo_cerrado");
    await expect(db.query("select erp.fn_close_tax_period(2026, 4, 'admin')")).rejects.toThrow(/ya está cerrado/);
    await expect(db.query("select erp.fn_reopen_tax_period(2026, 4, 'corto', 'admin')")).rejects.toThrow(/motivo/);

    await db.query("select erp.fn_reopen_tax_period(2026, 4, 'Falta una factura de octubre', 'admin')");
    expect((await ingest([gasto()]))[0].result).toBe("insertada");
    const ev = await db.query<{ action: string }>("select action from erp.tax_period_events order by id");
    expect(ev.rows.map((e) => e.action)).toEqual(["cerrado", "reabierto"]);
  });
});
