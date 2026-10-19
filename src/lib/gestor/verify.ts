import { readXlsxSheets, type XlsxCell } from "@/lib/ingest/parsers/xlsx";
import type { GestorModel } from "./model";
import { gastosFinRango, LIBRES_GASTOS, sheetNames } from "./xlsx";

// Verificación del .xlsx ya generado: se relee el fichero y se compara CELDA A
// CELDA con el modelo (que sale de la BBDD), más los totales de cada hoja. Si
// algo no coincide, el fichero no se guarda ni se entrega.

export type Verification = {
  ok: boolean;
  checks: { name: string; expected: number | string; actual: number | string; ok: boolean }[];
  /** Primeras diferencias celda a celda (vacío si todo coincide). */
  mismatches: string[];
};

const EPS = 0.005;
const serialToIso = (v: XlsxCell) =>
  typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10) : v;
const COLS = "ABCDEFGHIJKLM";

export function verifyGestorXlsx(bytes: Uint8Array, m: GestorModel): Verification {
  const sheets = readXlsxSheets(bytes);
  const N = sheetNames(m);
  const checks: Verification["checks"] = [];
  const mismatches: string[] = [];
  const add = (name: string, expected: number | string, actual: number | string) => {
    const ok = typeof expected === "number" && typeof actual === "number" ? Math.abs(expected - actual) < EPS : expected === actual;
    checks.push({ name, expected, actual, ok });
  };

  const order = [N.saldos, N.ingresos, N.gastos, N.resumen];
  add("Hojas y su orden", order.join(" | "), sheets.map((s) => s.name).join(" | "));
  const sheet = (name: string) => sheets.find((s) => s.name === name)?.rows ?? [];

  /** Compara una celda esperada con la leída (números con tolerancia de medio céntimo). */
  const cell = (where: string, rows: XlsxCell[][], row: number, col: number, expected: string | number | null) => {
    const raw = rows[row - 1]?.[col - 1] ?? null;
    const actual = raw === null ? null : raw;
    const same =
      expected === null
        ? actual === null || actual === ""
        : typeof expected === "number"
          ? typeof actual === "number" && Math.abs(actual - expected) < EPS
          : String(actual ?? "") === expected;
    if (!same && mismatches.length < 30) {
      mismatches.push(`${where}!${COLS[col - 1]}${row}: esperado «${expected ?? ""}», en el Excel «${actual ?? ""}»`);
    }
    return same;
  };
  /** `undefined` = celda que no se compara (p. ej. una fórmula de porcentaje). */
  const block = (name: string, rows: XlsxCell[][], expected: (string | number | null | undefined)[][], fromRow = 2) => {
    let bad = 0;
    expected.forEach((cols, i) =>
      cols.forEach((v, c) => {
        if (v !== undefined && !cell(name, rows, fromRow + i, c + 1, v)) bad++;
      }),
    );
    return bad;
  };
  const value = (rows: XlsxCell[][], row: number, col: number) => {
    const v = rows[row - 1]?.[col - 1];
    return typeof v === "number" ? v : NaN;
  };
  const dataRows = (rows: XlsxCell[][]) => {
    let n = 0;
    while (rows[n + 1]?.[0] !== null && rows[n + 1]?.[0] !== undefined) n++;
    return n;
  };

  // ── Ingresos ──
  const ing = sheet(N.ingresos);
  add("Ingresos: nº de filas", m.ingresos.length, dataRows(ing));
  const ingBad = block(
    N.ingresos,
    ing.map((r) => r.map((v, c) => (c === 0 || c === 9 ? serialToIso(v) : v))),
    m.ingresos.map((r) => [
      r.fecha, r.numero, r.doc || null, r.razon, r.base, r.impuestos, undefined, r.cantidad, r.forma_pago || null, r.fecha_pago, r.cp,
    ]),
  );
  add("Ingresos: celdas distintas", 0, ingBad);
  const li = m.ingresos.length + 1;
  add("Ingresos: SUMA TOTAL", m.kpis.ing_total, value(ing, li + 3, 5));
  add("Ingresos: IVA MOD 303", m.kpis.ing_iva, value(ing, li + 5, 5));

  // ── Gastos ──
  const gas = sheet(N.gastos);
  add("Gastos: nº de filas", m.gastos.length, dataRows(gas));
  const gasBad = block(
    N.gastos,
    gas.map((r) => r.map((v, c) => (c === 0 ? serialToIso(v) : v))),
    m.gastos.map((g) => [
      g.fecha, g.factura || null, g.cif || null, g.razon, g.tipo_gasto || null, g.forma_pago || null,
      g.base, g.impuestos, g.tipo_impuesto, g.tasa_ret, g.retencion, g.cantidad, g.asiento,
    ]),
  );
  add("Gastos: celdas distintas", 0, gasBad);
  const lg = m.gastos.length + 1;
  let libres = 0;
  for (let k = 1; k <= LIBRES_GASTOS; k++) if ((gas[lg + k - 1] ?? []).some((v) => v !== null)) libres++;
  add("Gastos: filas libres vacías", 0, libres);
  const t = gastosFinRango(m) + 2;
  add("Gastos: suma base", m.kpis.gas_base, value(gas, t + 1, 6));
  add("Gastos: suma impuestos", m.kpis.gas_iva, value(gas, t + 1, 7));
  add("Gastos: suma retenciones", m.kpis.gas_ret, value(gas, t + 1, 8));
  add("Gastos: suma total", m.kpis.gas_total, value(gas, t + 1, 9));

  // ── Saldos ──
  const sal = sheet(N.saldos);
  add("Saldos: nº de pacientes", m.saldos.length, dataRows(sal) || (sal[1]?.[0] ? 1 : 0));
  const salBad = block(N.saldos, sal, m.saldos.map((s) => [s.nombre, s.doc || null, s.telefono, s.cp, s.saldo]));
  add("Saldos: celdas distintas", 0, salBad);
  const ls = m.saldos.length + 1;
  add("Saldos: total acreedores", m.kpis.sal_acre, value(sal, ls + 3, 5));
  add("Saldos: total deudores", m.kpis.sal_deu, value(sal, ls + 4, 5));
  add("Saldos: saldo neto", m.kpis.sal_neto, value(sal, ls + 5, 5));

  // ── Resumen ──
  const res = sheet(N.resumen);
  const byLabel = (label: string) => {
    const row = res.find((r) => r[0] === label);
    return typeof row?.[1] === "number" ? row[1] : NaN;
  };
  add("Resumen: base facturada", m.kpis.ing_base, byLabel("Base imponible facturada"));
  add("Resumen: base de gastos", m.kpis.gas_base, byLabel("Base imponible de gastos"));
  add("Resumen: resultado", m.kpis.resultado, byLabel("Ingresos (base) − Gastos (base)"));

  return { ok: checks.every((c) => c.ok) && mismatches.length === 0, checks, mismatches };
}
