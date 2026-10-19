import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { buildGestorModel, type ExportData, type GestorModel } from "@/lib/gestor/model";
import { verifyGestorXlsx } from "@/lib/gestor/verify";
import { writeGestorXlsx } from "@/lib/gestor/xlsx";
import { parseDocument } from "@/lib/ingest/parsers";
import { readXlsxSheets, type XlsxCell } from "@/lib/ingest/parsers/xlsx";
import type { NormalizedInvoice, ParsedDocument } from "@/lib/ingest/types";
import { createTestDb } from "./helpers/db";

// Regresión de extremo a extremo con el 3T2026 REAL:
//   PDF de Optimydent → ingesta en la BBDD → correcciones con las herramientas
//   del ERP (las mismas que se hicieron a mano en la app anterior) →
//   fn_gestor_export_data → Excel → se compara fila a fila y celda a celda
//   con el Excel que se entregó al gestor (v2).
// Ficheros en tests/fixtures/private/ (fuera del repositorio).

const PRIVATE = join(__dirname, "fixtures", "private");
const fixture = (name: string) => new Uint8Array(readFileSync(join(PRIVATE, name)));
const ready = ["optimydent-gastos-3T2026.pdf", "gestor-3T2026-v2.xlsx"].every((f) => existsSync(join(PRIVATE, f)));

let db: PGlite;
let run: string;
let model: GestorModel;
let bytes: Uint8Array;
let v2: ReturnType<typeof readXlsxSheets>;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
async function ingest(items: NormalizedInvoice[] | object[]) {
  const out: { result: string; message?: string; conflict_id?: string }[] = [];
  for (let i = 0; i < items.length; i += 200) {
    const r = await one<{ res: typeof out }>("select erp.fn_ingest_invoices($1::jsonb, $2, null) as res", [
      JSON.stringify(items.slice(i, i + 200)),
      run,
    ]);
    out.push(...r.res);
  }
  return out;
}
const invoiceId = async (taxOrName: string, number: string, date?: string) =>
  (
    await one<{ id: string }>(
      `select id from erp.invoices where status <> 'anulada' and invoice_number = $2
          and (issuer_tax_id = $1 or issuer_name = $1) and ($3::date is null or issue_date = $3)`,
      [taxOrName, number, date ?? null],
    )
  ).id;
const typeId = async (name: string) => (await one<{ id: string }>("select id from erp.expense_types where name = $1", [name])).id;
const edit = (id: string, p: object, reason = "Corrección del 3T2026 (como en la app anterior)") =>
  db.query("select erp.fn_edit_invoice($1, $2::jsonb, $3, 'test')", [id, JSON.stringify(p), reason]);

/** Quita las líneas repetidas (mismos importes y tipo) dejando la primera de cada grupo. */
async function removeDuplicateLines(id: string) {
  const lines = (
    await db.query<{ line_no: number; k: string }>(
      "select line_no, base || '|' || vat_amount || '|' || vat_rate as k from erp.invoice_lines where invoice_id = $1 order by line_no",
      [id],
    )
  ).rows;
  const seen = new Set<string>();
  const remove = lines.filter((l) => (seen.has(l.k) ? true : (seen.add(l.k), false))).map((l) => l.line_no);
  expect(remove.length).toBeGreaterThan(0);
  await edit(id, { remove_lines: remove }, "Línea duplicada en Optimydent");
}

const iso = (v: XlsxCell) =>
  typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10) : v;
const c2 = (v: XlsxCell) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const dataRows = (rows: XlsxCell[][]) => {
  const out: XlsxCell[][] = [];
  for (let i = 1; i < rows.length && rows[i]?.[0] !== null && rows[i]?.[0] !== undefined; i++) out.push(rows[i]);
  return out;
};
const sheet = (name: string) => v2.find((s) => s.name === name)!.rows;

// Diferencias INTENCIONADAS con el Excel anterior (el dato del ERP es el limpio):
//   · NIF/CIF sin guiones ni espacios ("B-98095243" → "B98095243"), el formato de Hacienda.
//   · Código postal inválido ("0", "460909") → vacío.
const nif = (v: XlsxCell) => (v === null || v === undefined ? "" : String(v).replace(/[^A-Za-z0-9]/g, "").toUpperCase());
const cp = (v: XlsxCell) => (typeof v === "number" && v >= 1000 && v <= 52999 ? v : null);

describe.skipIf(!ready)("Excel del gestor 3T2026: el ERP reproduce el Excel entregado", () => {
  beforeAll(async () => {
    db = await createTestDb();
    run = (await one<{ id: string }>("select erp.fn_start_sync_run('optimydent_fichero', 'subida_manual', 'test') as id")).id;
    v2 = readXlsxSheets(fixture("gestor-3T2026-v2.xlsx"));
    const parse = async (f: string) => parseDocument(fixture(f), { asOf: "2026-10-06" });
    const inv = (d: ParsedDocument) => ("invoices" in d ? d.invoices : []);

    // 1) Listados de Optimydent tal cual.
    const gastos = await ingest(inv(await parse("optimydent-gastos-3T2026.pdf")));
    expect(gastos.filter((r) => r.result === "error")).toEqual([]);
    expect((await ingest(inv(await parse("optimydent-emitidas-3T2026.pdf")))).filter((r) => r.result === "error")).toEqual([]);
    for (const f of ["optimydent-acreedores-3T2026.pdf", "optimydent-deudores-3T2026.pdf"]) {
      const d = await parse(f);
      if (!("lines" in d)) throw new Error("no es un listado de saldos");
      await db.query("select erp.fn_ingest_balance_snapshot($1::jsonb, $2, null)", [
        JSON.stringify({ as_of: d.asOf, side: d.side, lines: d.lines }),
        run,
      ]);
    }

    // 2) Conflictos (mismo emisor + nº con otra fecha), resueltos como se hizo
    //    a mano en la app anterior:
    //    · OPTO2026/1013 julio y agosto: dos facturas distintas → mantener ambas.
    //    · DH 2634829 el 07/09 y el 14/09: la segunda es la misma → mantener la existente.
    //    · Alexis 230/1 el 23/09 y el 21/09: la buena es la del 21 → sustituir.
    const conflicts = (
      await db.query<{ id: string; num: string }>(
        "select c.id, e.invoice_number as num from erp.ingest_conflicts c join erp.invoices e on e.id = c.existing_invoice_id",
      )
    ).rows;
    expect(conflicts.map((c) => c.num).sort()).toEqual(["230/1", "2634829", "OPTO2026/1013"]);
    const resolution = { "OPTO2026/1013": "mantener_ambas", "2634829": "mantener_existente", "230/1": "sustituir_por_entrante" };
    for (const c of conflicts) {
      await db.query("select erp.fn_resolve_conflict($1, $2, 'Igual que en el cierre del 3T2026', 'test')", [
        c.id,
        resolution[c.num as keyof typeof resolution],
      ]);
    }

    // 3) Facturas de doctoras con retención y emitidas a otra clínica (en
    //    producción llegan desde Repositorio): se toman del propio Excel v2.
    const gasV2 = dataRows(sheet("Gastos 3Q 2026"));
    await ingest(
      gasV2
        .filter((r) => r[4] === "Prestación servicios profesionales")
        .map((r) => ({
          direction: "recibida",
          issuer_tax_id: r[2],
          issuer_name: r[3],
          invoice_number: r[1],
          issue_date: iso(r[0]),
          counterparty: { kind: "profesional", tax_id: r[2], name: r[3] },
          base_total: c2(r[6]),
          vat_total: 0,
          withholding_total: c2(r[10]),
          total: Math.round(((r[6] as number) - (r[10] as number)) * 100) / 100,
          status: "pendiente",
          paid_at: null,
          payment_method: r[5],
          expense_type: r[4],
          source: "pdf_profesional",
          lines: [{ base: c2(r[6]), vat_rate: 0, vat_amount: 0, vat_exempt_reason: r[8], withholding_rate: r[9], withholding_amount: c2(r[10]) }],
        })),
    );
    const ingV2 = dataRows(sheet("Ingresos 3Q 2026"));
    await ingest(
      ingV2
        .filter((r) => /^\d{2}\/\d{4}$/.test(String(r[1]))) // 07/2026…: facturas a otra clínica (no P ni R)
        .map((r) => ({
          direction: "emitida",
          issuer_tax_id: "B67717082",
          issuer_name: "Dental Fontes Lluch SLP",
          invoice_number: r[1],
          issue_date: iso(r[0]),
          counterparty: { kind: "cliente", tax_id: r[2], name: r[3] },
          base_total: c2(r[4]),
          vat_total: 0,
          withholding_total: 0,
          total: c2(r[4]),
          status: "pendiente",
          paid_at: null,
          payment_method: r[8],
          source: "pdf_emitida",
          lines: [{ base: c2(r[4]), vat_rate: 0, vat_amount: 0, vat_exempt_reason: "Exenta" }],
        })),
    );

    // 4) Correcciones que en la app anterior se hicieron a mano (revisiones.json),
    //    ahora con «Corregir datos».
    await removeDuplicateLines(await invoiceId("B98375785", "CS26/381"));
    const software = await typeId("Software y Licencias");
    const laboratorio = await typeId("Facturas de Laboratorio");
    await edit(await invoiceId("B99549354", "OPTO2026/1013", "2026-07-15"), { invoice_number: "2026/0871", expense_type_id: software });
    await edit(await invoiceId("B99549354", "OPTO2026/1013", "2026-08-15"), { expense_type_id: software });
    await edit(await invoiceId("B99549354", "OPTO2026-1158"), { expense_type_id: software });
    await edit(await invoiceId("B06832323", "01313"), { expense_type_id: laboratorio });
    for (const num of ["INVDMFR100145", "INVDMFR100707", "INVDMFR103625"]) {
      await edit(await invoiceId("B67717082", num), { issuer_tax_id: "N0020102J", expense_type_id: laboratorio });
    }
    await edit(await invoiceId("Vistaprint B.V", "0239278852"), { issuer_tax_id: "NL812139513B01" });

    // 5) Exportación.
    const { data } = await one<{ data: ExportData }>("select erp.fn_gestor_export_data(2026, 3) as data");
    model = buildGestorModel(data);
    bytes = await writeGestorXlsx(model, { companyName: "Dental Fontes Lluch SLP" });
    if (process.env.SAVE_GESTOR_XLSX) writeFileSync(process.env.SAVE_GESTOR_XLSX, bytes);
  }, 120_000);

  it("no hay controles que bloqueen la generación", () => {
    expect(model.checks.filter((c) => c.level === "error")).toEqual([]);
  });

  it("el fichero generado se relee y cuadra celda a celda con la BBDD", () => {
    const v = verifyGestorXlsx(bytes, model);
    expect(v.mismatches).toEqual([]);
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it("Ingresos: las 466 filas, en el mismo orden y con los mismos datos que el Excel entregado", () => {
    const expected = dataRows(sheet("Ingresos 3Q 2026")).map((r) => [
      iso(r[0]), r[1], nif(r[2]), r[3], c2(r[4]), c2(r[5]), c2(r[7]), r[8] ?? "", iso(r[9]) ?? null, cp(r[10]),
    ]);
    const ours = model.ingresos.map((r) => [r.fecha, r.numero, r.doc, r.razon, r.base, r.impuestos, r.cantidad, r.forma_pago, r.fecha_pago, r.cp]);
    expect(ours.length).toBe(466);
    expect(ours).toEqual(expected);
  });

  it("Gastos: las 159 líneas, en el mismo orden y con los mismos datos que el Excel entregado", () => {
    const v2Rows = dataRows(sheet("Gastos 3Q 2026"));
    const expected = v2Rows.map((r) => [iso(r[0]), String(r[1]), nif(r[2]), r[3], r[4], r[5], c2(r[6]), c2(r[7]), r[8], c2(r[9]), c2(r[10]), c2(r[11])]);
    const ours = model.gastos.map((g) => [g.fecha, g.factura, g.cif, g.razon, g.tipo_gasto, g.forma_pago, g.base, g.impuestos, g.tipo_impuesto, g.tasa_ret, g.retencion, g.cantidad]);
    expect(ours.length).toBe(159);
    expect(ours).toEqual(expected);
    // Cuenta contable: igual en todas las líneas que la traían; el ERP además
    // completa las de las doctoras (vacías en el Excel anterior).
    const accountDiffs = model.gastos
      .map((g, i) => ({ g, was: v2Rows[i][12] }))
      .filter(({ g, was }) => was !== null && was !== undefined && g.asiento !== was);
    expect(accountDiffs).toEqual([]);
  });

  it("Saldos: los 93 pacientes y los mismos totales", () => {
    const expected = dataRows(sheet("Saldos pacientes 06102026")).map((r) => [r[0], nif(r[1]), r[2] ?? null, cp(r[3]), c2(r[4])]);
    const ours = model.saldos.map((s) => [s.nombre, s.doc, s.telefono, s.cp, s.saldo]);
    expect(ours.length).toBe(93);
    expect(ours).toEqual(expected);
    expect([model.kpis.sal_acre, model.kpis.sal_deu]).toEqual([124117.87, -4582.15]);
  });

  it("totales del Resumen iguales a los del Excel entregado", () => {
    expect(model.kpis).toMatchObject({
      ing_n: 466,
      ing_base: 133805.58,
      ing_iva: 0,
      gas_n: 159,
      gas_iva: 5083.41,
    });
    const res = sheet("Resumen 3Q 2026");
    const v2Value = (label: string) => res.find((r) => r[0] === label)?.[1];
    expect(model.kpis.gas_base).toBeCloseTo(v2Value("Base imponible de gastos") as number, 2);
    expect(model.kpis.gas_total).toBeCloseTo(v2Value("Total gastos (neto de retenciones)") as number, 2);
    expect(model.kpis.resultado).toBeCloseTo(v2Value("Ingresos (base) − Gastos (base)") as number, 2);
  });
});
