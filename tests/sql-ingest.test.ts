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

async function ingest(items: object[], run: string | null = runId) {
  const r = await one<{ res: Row[] }>("select erp.fn_ingest_invoices($1::jsonb, $2, null) as res", [
    JSON.stringify(items),
    run,
  ]);
  return r.res;
}

const gasto = (over: Partial<Record<string, unknown>> = {}) => ({
  direction: "recibida",
  issuer_tax_id: "B12345678",
  issuer_name: "Finandreu S.L.",
  invoice_number: "A-101",
  issue_date: "2026-10-06",
  base_total: 1221.23,
  vat_total: 256.46,
  withholding_total: 0,
  total: 1477.69,
  status: "pagada",
  paid_at: "2026-10-06",
  expense_type: "Alquiler Local",
  source: "optimydent",
  lines: [{ base: 1221.23, vat_rate: 0.21, vat_amount: 256.46 }],
  ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  runId = (await one<{ id: string }>("select erp.fn_start_sync_run('optimydent_fichero', 'subida_manual', 'test') as id")).id;
});

describe("datos maestros", () => {
  it("siembra cuentas, tipos de gasto con partida y bancos", async () => {
    const { n } = await one<{ n: number }>("select count(*)::int as n from erp.expense_types");
    expect(n).toBe(65);
    const sinPartida = await one<{ n: number }>(
      "select count(*)::int as n from erp.expense_types where category_id is null or account_code is null",
    );
    expect(sinPartida.n).toBe(0);
    const banks = await db.query<{ bank: string }>("select bank from erp.bank_accounts order by bank");
    expect(banks.rows.map((r) => r.bank)).toEqual(["caixabank", "caja", "kutxabank"]);
  });
});

describe("fn_ingest_invoices", () => {
  it("alta con tipo conocido → cuenta y partida por regla", async () => {
    const [r] = await ingest([gasto()]);
    expect(r.result).toBe("insertada");
    const inv = await one(
      `select i.category_source, c.name as cat, l.account_code, p.kind
         from erp.invoices i join erp.expense_categories c on c.id = i.category_id
         join erp.invoice_lines l on l.invoice_id = i.id join erp.parties p on p.id = i.counterparty_id`,
    );
    expect(inv).toMatchObject({ category_source: "regla", cat: "Alquiler y local", account_code: "62100000", kind: "proveedor" });
  });

  it("misma factura otra vez → sin cambios; luego Pendiente → Pagada → actualizada + historial", async () => {
    await ingest([gasto({ status: "pendiente", paid_at: null })]);
    expect((await ingest([gasto({ status: "pendiente", paid_at: null })]))[0].result).toBe("sin_cambios");
    const [r] = await ingest([gasto({ status: "pagada", paid_at: "2026-10-20" })]);
    expect(r).toMatchObject({ result: "actualizada", from_status: "pendiente", to_status: "pagada" });
    const h = await one<{ n: number }>("select count(*)::int as n from erp.invoice_status_history");
    expect(h.n).toBe(1);
  });

  it("el estado tocado a mano no lo pisa la sincronización", async () => {
    const [r] = await ingest([gasto({ status: "pendiente", paid_at: null })]);
    await db.query(
      "update erp.invoices set status = 'pagada', paid_at = '2026-10-07', paid_amount = total, manual_fields = '{status}' where id = $1",
      [r.invoice_id],
    );
    expect((await ingest([gasto({ status: "pendiente", paid_at: null })]))[0].result).toBe("sin_cambios");
  });

  it("mismo nº con otro importe → conflicto (una sola vez) con las diferencias", async () => {
    await ingest([gasto()]);
    const otro = gasto({ total: 1500, base_total: 1243.54, lines: [{ base: 1243.54, vat_rate: 0.21, vat_amount: 256.46 }] });
    const [c1] = await ingest([otro]);
    expect(c1.result).toBe("conflicto");
    const [c2] = await ingest([otro]);
    expect(c2.result).toBe("conflicto_pendiente");
    const c = await one<{ differences: Row }>("select differences from erp.ingest_conflicts");
    expect(c.differences.total).toEqual([1477.69, 1500]);
  });

  it("sustituir por la entrante anula la existente y el dato viejo queda como lápida", async () => {
    const [orig] = await ingest([gasto()]);
    const otro = gasto({ total: 1500, base_total: 1243.54, lines: [{ base: 1243.54, vat_rate: 0.21, vat_amount: 256.46 }] });
    const [c] = await ingest([otro]);
    const { id: nueva } = await one<{ id: string }>(
      "select erp.fn_resolve_conflict($1, 'sustituir_por_entrante', 'Importe corregido por el proveedor', 'admin') as id",
      [c.conflict_id],
    );
    const vieja = await one("select status, void_reason from erp.invoices where id = $1", [orig.invoice_id]);
    expect(vieja.status).toBe("anulada");
    const n = await one("select corrects_invoice_id, total::float as total, category_source from erp.invoices where id = $1", [nueva]);
    expect(n).toMatchObject({ corrects_invoice_id: orig.invoice_id, total: 1500, category_source: "regla" });
    // Optimydent vuelve a mandar el dato viejo → se reconoce y se ignora.
    expect((await ingest([gasto()]))[0].result).toBe("ignorada_anulada");
    expect((await ingest([otro]))[0].result).toBe("sin_cambios");
  });

  it("mantener la existente: el entrante no vuelve a aparecer", async () => {
    await ingest([gasto()]);
    const otro = gasto({ total: 1500, base_total: 1243.54, lines: [{ base: 1243.54, vat_rate: 0.21, vat_amount: 256.46 }] });
    const [c] = await ingest([otro]);
    await db.query("select erp.fn_resolve_conflict($1, 'mantener_existente', null, 'admin')", [c.conflict_id]);
    expect((await ingest([otro]))[0].result).toBe("ignorada_resuelta");
  });

  it("corregir sin cambiar datos fiscales se rechaza (se edita directamente)", async () => {
    const [r] = await ingest([gasto()]);
    await expect(
      db.query("select erp.fn_correct_invoice($1, $2::jsonb, 'Cambio de categoría sin más', 'admin')", [
        r.invoice_id,
        JSON.stringify(gasto()),
      ]),
    ).rejects.toThrow(/no cambian/);
  });

  it("tipo de gasto nuevo → se crea sin cuenta y la factura queda para revisión", async () => {
    await ingest([gasto({ expense_type: "Tipo Inventado" })]);
    const inv = await one<{ needs_review: boolean; review_reasons: string[] }>(
      "select needs_review, review_reasons from erp.invoices",
    );
    expect(inv.needs_review).toBe(true);
    expect(inv.review_reasons).toContain("tipo_gasto_nuevo");
    const t = await one("select needs_review, account_code from erp.expense_types where name = 'Tipo Inventado'");
    expect(t).toMatchObject({ needs_review: true, account_code: null });
  });

  it("un error en una factura no tumba el lote", async () => {
    const res = await ingest([
      gasto(),
      gasto({ invoice_number: "A-102", lines: [{ base: 1, vat_rate: 0.21, vat_amount: 0 }] }),
      gasto({ invoice_number: "A-103" }),
    ]);
    expect(res.map((r) => r.result)).toEqual(["insertada", "error", "insertada"]);
    expect(String(res[1].message)).toMatch(/no cuadran/);
  });

  it("trimestre cerrado → periodo_cerrado (sin abortar), pero el cobro posterior sí entra", async () => {
    const [r] = await ingest([gasto({ status: "pendiente", paid_at: null })]);
    await db.query("insert into erp.tax_periods (year, quarter, status) values (2026, 4, 'cerrado')");
    expect((await ingest([gasto({ invoice_number: "A-999" })]))[0].result).toBe("periodo_cerrado");
    const [m] = await ingest([gasto({ status: "pagada", paid_at: "2027-01-10" })]);
    expect(m).toMatchObject({ result: "actualizada", invoice_id: r.invoice_id });
  });

  it("emitida a paciente exenta: contrapartida paciente y cuenta 705 por defecto", async () => {
    const [r] = await ingest([
      {
        direction: "emitida",
        issuer_tax_id: "B67717082",
        issuer_name: "Dental Fontes Lluch SLP",
        invoice_number: "P1632/2026",
        issue_date: "2026-09-30",
        counterparty: { kind: "paciente", tax_id: "11111111h", name: "Paciente Prueba", clinical_record: "8" },
        base_total: 200,
        vat_total: 0,
        total: 200,
        status: "pagada",
        paid_at: "2026-09-30",
        source: "optimydent",
        lines: [{ base: 200, vat_rate: 0, vat_amount: 0, vat_exempt_reason: "art. 20 LIVA" }],
      },
    ]);
    expect(r.result).toBe("insertada");
    const x = await one(
      `select p.kind, p.tax_id, p.clinical_record, l.account_code from erp.invoices i
         join erp.parties p on p.id = i.counterparty_id join erp.invoice_lines l on l.invoice_id = i.id`,
    );
    expect(x).toMatchObject({ kind: "paciente", tax_id: "11111111H", clinical_record: "8", account_code: "70500000" });
  });

  it("listado subido otra vez con columnas secundarias añadidas → solo completa los datos vacíos", async () => {
    const [r] = await ingest([gasto({ counterparty: { kind: "proveedor", tax_id: "B12345678", name: "Finandreu S.L." } })]);
    const [again] = await ingest([
      gasto({
        counterparty: { kind: "proveedor", tax_id: "B12345678", name: "Finandreu S.L.", postal_code: "08001" },
        lines: [{ base: 1221.23, vat_rate: 0.21, vat_amount: 256.46, description: "Alquiler octubre" }],
      }),
    ]);
    expect(again).toMatchObject({ result: "completada", invoice_id: r.invoice_id });
    const x = await one(
      `select l.description, p.postal_code from erp.invoices i
         join erp.invoice_lines l on l.invoice_id = i.id join erp.parties p on p.id = i.counterparty_id`,
    );
    expect(x).toMatchObject({ description: "Alquiler octubre", postal_code: "08001" });

    // Lo que ya tiene valor no se pisa, y la tercera subida no cambia nada.
    const [third] = await ingest([
      gasto({ lines: [{ base: 1221.23, vat_rate: 0.21, vat_amount: 256.46, description: "Otro texto" }] }),
    ]);
    expect(third.result).toBe("sin_cambios");
    expect((await one("select description from erp.invoice_lines")).description).toBe("Alquiler octubre");
  });

  it("las líneas siguen siendo inmutables salvo rellenar una descripción vacía", async () => {
    await ingest([gasto()]);
    await expect(db.query("update erp.invoice_lines set base = 1")).rejects.toThrow(/inmutable/);
    await expect(db.query("update erp.invoice_lines set description = 'x', account_code = null")).rejects.toThrow(
      /inmutable/,
    );
    await expect(db.query("delete from erp.invoice_lines")).rejects.toThrow(/inmutable/);
    await db.query("update erp.invoice_lines set description = 'Alquiler'");
    await expect(db.query("update erp.invoice_lines set description = 'Otro'")).rejects.toThrow(/inmutable/);
  });
});

describe("nº de factura compartido", () => {
  const seguro = (date: string) =>
    gasto({
      issuer_tax_id: "A28007748",
      issuer_name: "Mapfre Seguros",
      invoice_number: "-",
      issue_date: date,
      paid_at: date,
      base_total: 85.2,
      vat_total: 0,
      total: 85.2,
      expense_type: "Seguros",
      lines: [{ base: 85.2, vat_rate: 0, vat_amount: 0, vat_exempt_reason: "Exento" }],
    });
  const otra = () =>
    gasto({
      issue_date: "2026-08-03",
      paid_at: "2026-08-03",
      total: 1500,
      base_total: 1243.54,
      lines: [{ base: 1243.54, vat_rate: 0.21, vat_amount: 256.46 }],
    });
  const live = async () =>
    (
      await db.query<{ id: string; issue_date: string; shares_number: boolean; review_reasons: string[]; notes: string | null }>(
        "select id, issue_date::text, shares_number, review_reasons, notes from erp.invoices where status <> 'anulada' order by issue_date",
      )
    ).rows;

  it("cargos mensuales sin nº («-»): todos se registran, sin conflicto, marcados «sin nº»", async () => {
    const meses = ["2026-07-05", "2026-08-05", "2026-09-05"];
    expect((await ingest(meses.map(seguro))).map((r) => r.result)).toEqual(["insertada", "insertada", "insertada"]);
    expect((await ingest(meses.map(seguro))).map((r) => r.result)).toEqual(["sin_cambios", "sin_cambios", "sin_cambios"]);
    const rows = await live();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.review_reasons.includes("sin_numero"))).toBe(true);
    const c = await one<{ n: number }>("select count(*)::int as n from erp.ingest_conflicts");
    expect(c.n).toBe(0);
  });

  it("conflicto de un cargo sin nº ya existente → «mantener ambas» lo registra sin marcar nº repetido", async () => {
    const [first] = await ingest([seguro("2026-07-05")]);
    const incoming = { ...seguro("2026-08-05"), dedup_hash: "x" };
    const { id } = await one<{ id: string }>(
      "insert into erp.ingest_conflicts (sync_run_id, existing_invoice_id, incoming, differences) values ($1, $2, $3, '{}') returning id",
      [runId, first.invoice_id, JSON.stringify(incoming)],
    );
    await db.query("select erp.fn_resolve_conflict($1, 'mantener_ambas', null, 'admin')", [id]);
    const rows = await live();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.shares_number && r.review_reasons.includes("sin_numero"))).toBe(true);
  });

  it("mismo nº con otra fecha e importe → «mantener ambas»: las dos vivas, marcadas y con nota cruzada", async () => {
    await ingest([gasto()]);
    const [c] = await ingest([otra()]);
    expect(c.result).toBe("conflicto");
    await db.query("select erp.fn_resolve_conflict($1, 'mantener_ambas', null, 'admin')", [c.conflict_id]);

    const rows = await live();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.shares_number).toBe(true);
      expect(r.review_reasons).toContain("numero_factura_repetido");
    }
    expect(rows[0].notes).toMatch(/otra del 06\/10\/2026 por 1477,69 €/);
    expect(rows[1].notes).toMatch(/otra del 03\/08\/2026 por 1500,00 €/);

    // Volver a subir el listado no crea nada nuevo ni más conflictos.
    expect((await ingest([gasto(), otra()])).map((r) => r.result)).toEqual(["sin_cambios", "sin_cambios"]);
    // Un tercer dato con el mismo nº vuelve a conflicto (una sola vez).
    const tercera = gasto({ issue_date: "2026-09-01", paid_at: "2026-09-01" });
    expect((await ingest([tercera]))[0].result).toBe("conflicto");
    expect((await ingest([tercera]))[0].result).toBe("conflicto_pendiente");
  });

  it("después se puede anular una (no vuelve a entrar), corregir el nº de la otra y darla por revisada", async () => {
    const [a] = await ingest([gasto()]);
    const [c] = await ingest([otra()]);
    const { id: b } = await one<{ id: string }>("select erp.fn_resolve_conflict($1, 'mantener_ambas', null, 'admin') as id", [
      c.conflict_id,
    ]);

    await db.query("select erp.fn_void_invoice($1, 'Duplicada en Optimydent', 'admin')", [b]);
    expect((await ingest([otra()]))[0].result).toBe("ignorada_anulada");

    const { id: nueva } = await one<{ id: string }>(
      "select erp.fn_correct_invoice_identity($1, 'A-101B', '2026-10-06', 'El nº correcto es A-101B', 'admin') as id",
      [a.invoice_id],
    );
    const n = await one("select invoice_number, total::float as total, status, corrects_invoice_id from erp.invoices where id = $1", [nueva]);
    expect(n).toMatchObject({ invoice_number: "A-101B", total: 1477.69, status: "pagada", corrects_invoice_id: a.invoice_id });
    const lines = await one<{ n: number }>("select count(*)::int as n from erp.invoice_lines where invoice_id = $1", [nueva]);
    expect(lines.n).toBe(1);

    await db.query("update erp.invoices set needs_review = true, review_reasons = '{numero_factura_repetido}' where id = $1", [nueva]);
    await db.query("select erp.fn_mark_invoice_reviewed($1, null, 'admin')", [nueva]);
    expect(await one("select needs_review, review_reasons from erp.invoices where id = $1", [nueva])).toMatchObject({
      needs_review: false,
      review_reasons: [],
    });
  });

  it("corregir a un nº que ya usa otra factura viva → error claro, sin anular nada", async () => {
    const [a] = await ingest([gasto()]);
    await ingest([gasto({ invoice_number: "A-102", issue_date: "2026-08-03", paid_at: "2026-08-03" })]);
    await expect(
      db.query("select erp.fn_correct_invoice_identity($1, 'A-102', '2026-10-06', 'Probando el nº repetido', 'admin')", [
        a.invoice_id,
      ]),
    ).rejects.toThrow(/Ya hay otra factura de este emisor con el nº A-102/);
    expect((await one("select status from erp.invoices where id = $1", [a.invoice_id])).status).toBe("pagada");
  });

  it("sin «mantener ambas», la base de datos sigue impidiendo dos facturas vivas con el mismo nº", async () => {
    await ingest([gasto()]);
    await expect(ingest([{ ...otra(), force_insert: true }])).resolves.toMatchObject([{ result: "error" }]);
  });
});

describe("bancos y saldos", () => {
  it("descargas solapadas no duplican y los cargos idénticos del mismo día se distinguen por el saldo", async () => {
    const { id } = await one<{ id: string }>("select id from erp.bank_accounts where bank = 'caixabank'");
    const tx = (balance: number) => ({ booking_date: "2026-09-28", amount: -859.1, balance_after: balance, description: "ORMCO B.V" });
    const a = await one<{ r: Row }>("select erp.fn_ingest_bank_transactions($1, $2::jsonb, null) as r", [
      id,
      JSON.stringify([tx(15483.04), tx(16342.14), tx(17201.24)]),
    ]);
    expect(a.r).toEqual({ insertados: 3, duplicados: 0 });
    const b = await one<{ r: Row }>("select erp.fn_ingest_bank_transactions($1, $2::jsonb, null) as r", [
      id,
      JSON.stringify([tx(16342.14), tx(17201.24), tx(18060.34)]),
    ]);
    expect(b.r).toEqual({ insertados: 1, duplicados: 2 });
  });

  it("saldos: misma foto dos veces → sin cambios; signo contrario → error", async () => {
    const snap = {
      as_of: "2026-10-01",
      side: "deudores",
      lines: [
        { tax_id: "44504119Q", name: "A", balance: -23 },
        { tax_id: "44504119Q", name: "A", balance: -10 },
        { tax_id: null, name: "Sin Doc", balance: -5 },
      ],
    };
    const r1 = await one<{ r: Row }>("select erp.fn_ingest_balance_snapshot($1::jsonb, null, null) as r", [JSON.stringify(snap)]);
    expect(r1.r).toMatchObject({ result: "insertada", total: -38, patients: 2 });
    const r2 = await one<{ r: Row }>("select erp.fn_ingest_balance_snapshot($1::jsonb, null, null) as r", [JSON.stringify(snap)]);
    expect(r2.r.result).toBe("sin_cambios");
    await expect(
      db.query("select erp.fn_ingest_balance_snapshot($1::jsonb, null, null)", [
        JSON.stringify({ ...snap, lines: [{ tax_id: "X1", name: "B", balance: 50 }] }),
      ]),
    ).rejects.toThrow(/signo contrario/);
  });
});

describe("Diario", () => {
  const asiento = (date: string, amount: number) => ({
    entry_date: date,
    description: "Factura alquiler",
    kind: "factura_recibida",
    posted_by: "test",
    lines: [
      { account_code: "62100000", debit: amount },
      { account_code: "41000000", credit: amount },
    ],
  });

  it("numera por ejercicio, encadena hashes que verify_journal_chain valida y rectifica", async () => {
    const { id: e1 } = await one<{ id: string }>("select erp.fn_post_journal_entry($1::jsonb) as id", [
      JSON.stringify(asiento("2026-10-06", 1221.23)),
    ]);
    await db.query("select erp.fn_post_journal_entry($1::jsonb)", [JSON.stringify(asiento("2026-10-07", 10.005))]);
    await db.query("select erp.fn_post_journal_entry($1::jsonb)", [JSON.stringify(asiento("2027-01-02", 5))]);
    await db.query("select erp.fn_reverse_journal_entry($1, '2026-10-08', 'Error en la cuenta de gasto', 'test')", [e1]);

    const nums = await db.query<{ fiscal_year: number; entry_number: number }>(
      "select fiscal_year, entry_number from erp.journal_entries order by seq",
    );
    expect(nums.rows.map((r) => `${r.entry_number}/${r.fiscal_year}`)).toEqual(["1/2026", "2/2026", "1/2027", "3/2026"]);
    const bad = await db.query("select * from erp.verify_journal_chain()");
    expect(bad.rows).toEqual([]);

    const rev = await one<{ debit: string; credit: string }>(
      "select debit, credit from erp.journal_lines l join erp.journal_entries e on e.id = l.entry_id where e.kind = 'rectificacion' and l.account_code = '62100000'",
    );
    expect(Number(rev.credit)).toBe(1221.23);
    await expect(
      db.query("select erp.fn_reverse_journal_entry($1, null, 'Segunda rectificación', 'test')", [e1]),
    ).rejects.toThrow();
  });

  it("asiento descuadrado → rechazado al COMMIT", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query("select erp.fn_post_journal_entry($1::jsonb)", [
          JSON.stringify({ ...asiento("2026-10-06", 10), lines: [{ account_code: "62100000", debit: 10 }, { account_code: "41000000", credit: 9 }] }),
        ]);
      }),
    ).rejects.toThrow(/descuadrado/);
  });
});

describe("sincronizaciones", () => {
  it("solo una en curso; una colgada >15 min se cierra sola", async () => {
    await expect(db.query("select erp.fn_start_sync_run('banco', 'subida_manual', 'admin')")).rejects.toThrow(/en curso/);
    await db.query("update erp.sync_runs set started_at = now() - interval '20 minutes'");
    await db.query("select erp.fn_start_sync_run('banco', 'subida_manual', 'admin')");
    const r = await db.query<{ status: string }>("select status from erp.sync_runs order by started_at");
    expect(r.rows.map((x) => x.status)).toEqual(["fallido", "en_curso"]);
  });
});

describe("vistas de tesorería", () => {
  it("saldo actual y detección de un tramo de movimientos sin cargar", async () => {
    const { id } = await one<{ id: string }>("select id from erp.bank_accounts where bank = 'kutxabank'");
    const load = (items: object[]) =>
      db.query("select erp.fn_ingest_bank_transactions($1, $2::jsonb, null)", [id, JSON.stringify(items)]);
    await load([
      { booking_date: "2026-09-01", amount: 100, balance_after: 1100, description: "A" },
      { booking_date: "2026-09-02", amount: -50, balance_after: 1050, description: "B" },
    ]);
    // Falta el movimiento que llevaba de 1050 a 2050.
    await load([{ booking_date: "2026-09-10", amount: 10, balance_after: 2060, description: "D" }]);
    const latest = await one<{ balance_after: string }>("select balance_after from erp.v_bank_latest_balance");
    expect(Number(latest.balance_after)).toBe(2060);
    const breaks = await db.query<{ missing_previous_balance: string }>("select missing_previous_balance from erp.v_bank_chain_breaks");
    expect(breaks.rows.map((r) => Number(r.missing_previous_balance))).toEqual([2050]);
  });
});
