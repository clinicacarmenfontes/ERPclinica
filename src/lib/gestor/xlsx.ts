import ExcelJS from "exceljs";
import type { GestorModel } from "./model";

// Escritura del .xlsx del gestor: réplica de contabilidad/excel.py (mismas
// hojas, columnas, formatos, fórmulas y bloque de totales). Cada fórmula se
// guarda con su resultado ya calculado, para que se lea bien aunque el
// programa no recalcule.

const EUR = '_-* #,##0.00\\ "€"_-;\\-* #,##0.00\\ "€"_-;_-* "-"??\\ "€"_-;_-@_-';
/** Filas en blanco antes del bloque de totales de Gastos (nóminas, SS, socia). */
export const LIBRES_GASTOS = 6;

const FONT = { name: "Calibri", size: 11 };
type Style = Partial<ExcelJS.Style>;
const S = {
  head: { font: { ...FONT, bold: true } },
  txt: { font: FONT, alignment: { horizontal: "center" } },
  txtL: { font: FONT },
  eur: { font: FONT, numFmt: EUR, alignment: { horizontal: "center" } },
  eurB: { font: { ...FONT, bold: true }, numFmt: EUR, alignment: { horizontal: "center" } },
  pct: { font: FONT, numFmt: "0%", alignment: { horizontal: "center" } },
  int: { font: FONT, numFmt: "0", alignment: { horizontal: "center" } },
  date: { font: FONT, numFmt: "yyyy-mm-dd", alignment: { horizontal: "center" } },
  lab: { font: { ...FONT, bold: true }, alignment: { horizontal: "right" } },
  libre: { font: FONT, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9DB" } } },
  input: {
    font: { ...FONT, bold: true },
    numFmt: EUR,
    alignment: { horizontal: "center" },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } },
  },
  title: { font: { ...FONT, bold: true, size: 14 } },
  sub: { font: { ...FONT, italic: true, color: { argb: "FF555555" } } },
  sec: {
    font: { ...FONT, bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F5B73" } },
  },
} satisfies Record<string, Style>;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** 'AAAA-MM-DD' → Date a medianoche UTC (exceljs la guarda como ese día exacto). */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const slash = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function put(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue, style: Style) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  cell.style = style;
  return cell;
}
const f = (formula: string, result: number): ExcelJS.CellFormulaValue => ({ formula, result });

export function sheetNames(m: GestorModel) {
  return {
    saldos: `Saldos pacientes ${m.saldosDate ? ddmmyyyy(m.saldosDate) : "sin fecha"}`,
    ingresos: `Ingresos ${m.quarter}Q ${m.year}`,
    gastos: `Gastos ${m.quarter}Q ${m.year}`,
    resumen: `Resumen ${m.quarter}Q ${m.year}`,
  };
}

/** Rango de filas de datos de Gastos incluidas las libres (para las sumas). */
export const gastosFinRango = (m: GestorModel) => m.gastos.length + 1 + LIBRES_GASTOS;

export async function writeGestorXlsx(m: GestorModel, opts: { companyName: string }): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Clínica Carmen Fontes";
  wb.title = `Contabilidad ${m.quarter}T ${m.year}`;
  wb.description = "Generado por el ERP a partir de los listados de Optimydent";
  const N = sheetNames(m);
  const wsSal = wb.addWorksheet(N.saldos);
  const wsIng = wb.addWorksheet(N.ingresos);
  const wsGas = wb.addWorksheet(N.gastos);
  const wsRes = wb.addWorksheet(N.resumen);

  // ── Saldos ──────────────────────────────────────────────────────────────
  ["Nombre", "Documento de identificación", "Teléfono", "Código postal", "Saldo"].forEach((h, c) => put(wsSal, 1, c + 1, h, S.head));
  m.saldos.forEach((s, i) => {
    const row = i + 2;
    put(wsSal, row, 1, s.nombre, S.txtL);
    put(wsSal, row, 2, s.doc, S.txtL);
    if (s.telefono !== null) put(wsSal, row, 3, s.telefono, S.int);
    if (s.cp !== null) put(wsSal, row, 4, s.cp, S.int);
    put(wsSal, row, 5, s.saldo, S.eur);
  });
  const lastSal = m.saldos.length + 1;
  let t = lastSal + 3;
  put(wsSal, t, 4, "Total acreedores", S.lab);
  put(wsSal, t, 5, f(`SUMIF(E2:E${lastSal},">0")`, m.kpis.sal_acre), S.eurB);
  put(wsSal, t + 1, 4, "Total deudores", S.lab);
  put(wsSal, t + 1, 5, f(`SUMIF(E2:E${lastSal},"<0")`, m.kpis.sal_deu), S.eurB);
  put(wsSal, t + 2, 4, "Saldo neto", S.lab);
  put(wsSal, t + 2, 5, f(`SUM(E2:E${lastSal})`, m.kpis.sal_neto), S.eurB);
  [38, 27, 12, 14, 16].forEach((w, c) => (wsSal.getColumn(c + 1).width = w));
  wsSal.views = [{ state: "frozen", ySplit: 1 }];
  wsSal.autoFilter = `A1:E${lastSal}`;

  // ── Ingresos ────────────────────────────────────────────────────────────
  [
    "Fecha factura", "Número", "Doc. Ident. Paciente", "Razón social", "Base imponible", "Impuestos",
    "Tipo IVA", "Cantidad", "Forma de pago", "Fecha de pago", "Código postal",
  ].forEach((h, c) => put(wsIng, 1, c + 1, h, S.head));
  m.ingresos.forEach((r, i) => {
    const x = i + 2;
    put(wsIng, x, 1, day(r.fecha), S.date);
    put(wsIng, x, 2, r.numero, S.txt);
    put(wsIng, x, 3, r.doc, S.txt);
    put(wsIng, x, 4, r.razon, S.txt);
    put(wsIng, x, 5, r.base, S.eur);
    put(wsIng, x, 6, r.impuestos, S.eur);
    put(wsIng, x, 7, f(`IF(E${x}=0,0,F${x}/E${x})`, r.base ? r.impuestos / r.base : 0), S.pct);
    put(wsIng, x, 8, f(`E${x}+F${x}`, r.cantidad), S.eur);
    put(wsIng, x, 9, r.forma_pago, S.txt);
    if (r.fecha_pago) put(wsIng, x, 10, day(r.fecha_pago), S.date);
    if (r.cp !== null) put(wsIng, x, 11, r.cp, S.int);
  });
  const li = m.ingresos.length + 1;
  t = li + 3;
  const baseIva = r2(m.ingresos.filter((r) => r.impuestos).reduce((s, r) => s + r.base, 0));
  put(wsIng, t, 4, "SUMA TOTAL ", S.lab);
  put(wsIng, t, 5, f(`SUM(H2:H${li})`, m.kpis.ing_total), S.eurB);
  put(wsIng, t + 1, 4, "BASE ING. MOD 303", S.lab);
  put(wsIng, t + 1, 5, f(`SUMIF(F2:F${li},"<>0",E2:E${li})`, baseIva), S.eurB);
  put(wsIng, t + 2, 4, "IVA MOD 303", S.lab);
  put(wsIng, t + 2, 5, f(`SUM(F2:F${li})`, m.kpis.ing_iva), S.eurB);
  put(wsIng, t + 3, 4, "BASE EXENTA (art. 20 LIVA)", S.lab);
  put(wsIng, t + 3, 5, f(`SUMIF(F2:F${li},0,E2:E${li})`, r2(m.kpis.ing_total - baseIva - m.kpis.ing_iva)), S.eurB);
  [13, 12, 19, 40, 16, 13, 9, 15, 22, 14, 14].forEach((w, c) => (wsIng.getColumn(c + 1).width = w));
  wsIng.views = [{ state: "frozen", ySplit: 1 }];
  wsIng.autoFilter = `A1:K${li}`;

  // ── Gastos ──────────────────────────────────────────────────────────────
  [
    "Fecha", "Factura", "CIF", "Razón social", "Tipo de gasto", "Forma de pago", "Base", "Impuestos",
    "Tipo de impuesto", "Tipo de Retención", "Retención", "Cantidad", "Asiento contable",
  ].forEach((h, c) => put(wsGas, 1, c + 1, h, S.head));
  m.gastos.forEach((g, i) => {
    const x = i + 2;
    put(wsGas, x, 1, day(g.fecha), S.date);
    put(wsGas, x, 2, g.factura, S.txt);
    put(wsGas, x, 3, g.cif, S.txt);
    put(wsGas, x, 4, g.razon, S.txt);
    put(wsGas, x, 5, g.tipo_gasto, S.txt);
    put(wsGas, x, 6, g.forma_pago, S.txt);
    put(wsGas, x, 7, g.base, S.eur);
    put(wsGas, x, 8, g.impuestos, S.eur);
    put(wsGas, x, 9, g.tipo_impuesto, S.txt);
    put(wsGas, x, 10, g.tasa_ret, S.pct);
    if (g.retencion) {
      // Doctoras: la retención que figura en su factura; cantidad = neto a pagar.
      put(wsGas, x, 11, g.retencion, S.eur);
      put(wsGas, x, 12, f(`G${x}+H${x}-K${x}`, g.cantidad), S.eur);
    } else {
      put(wsGas, x, 11, f(`+J${x}*G${x}`, 0), S.eur);
      put(wsGas, x, 12, f(`G${x}+H${x}`, g.cantidad), S.eur);
    }
    if (g.asiento !== null) put(wsGas, x, 13, g.asiento, S.int);
  });
  const lg = m.gastos.length + 1;
  const fin = gastosFinRango(m);
  for (let k = 1; k <= LIBRES_GASTOS; k++) {
    for (let c = 1; c <= 13; c++) put(wsGas, lg + k, c, null, S.libre);
  }
  wsGas.getCell(lg + 1, 1).note = "Filas libres para nóminas, Seguridad Social y retribución de la socia. Las sumas de abajo ya incluyen estas filas.";
  t = fin + 2; // cabecera del bloque de totales
  ["Base", "Impuesto", "Retención", "Total"].forEach((h, i) => put(wsGas, t, 6 + i, h, S.head));
  put(wsGas, t + 1, 4, "SUMA TOTAL", S.lab);
  put(wsGas, t + 1, 6, f(`+SUM(G2:G${fin})`, m.kpis.gas_base), S.eurB);
  put(wsGas, t + 1, 7, f(`+SUM(H2:H${fin})`, m.kpis.gas_iva), S.eurB);
  put(wsGas, t + 1, 8, f(`+SUM(K2:K${fin})`, m.kpis.gas_ret), S.eurB);
  put(wsGas, t + 1, 9, f(`+SUM(L2:L${fin})`, m.kpis.gas_total), S.eurB);
  put(wsGas, t + 2, 4, "TOT RETENCIONES PROFESIONALES", S.lab);
  put(wsGas, t + 2, 5, f(`+H${t + 1}`, m.kpis.gas_ret), S.eurB);
  put(wsGas, t + 3, 4, "TOT RETENCIONES TRABAJADORES", S.lab);
  put(wsGas, t + 3, 5, 0, S.input);
  put(wsGas, t + 3, 6, "← a completar por el asesor (retenciones de nóminas)", S.sub);
  put(wsGas, t + 4, 4, `TOTAL RETENC MOD 111 ${m.quarter}T ${m.year}`, S.lab);
  put(wsGas, t + 4, 5, f(`SUM(E${t + 2}:E${t + 3})`, m.kpis.gas_ret), S.eurB);
  [13.5, 25.7, 36.5, 54, 36.5, 29.7, 14, 14, 21.5, 17.2, 15, 15, 21.5].forEach((w, c) => (wsGas.getColumn(c + 1).width = w));
  wsGas.views = [{ state: "frozen", ySplit: 1 }];
  wsGas.autoFilter = `A1:M${lg}`;

  // ── Resumen ─────────────────────────────────────────────────────────────
  wsRes.getColumn(1).width = 46;
  wsRes.getColumn(2).width = 20;
  wsRes.getColumn(3).width = 62;
  put(wsRes, 1, 1, `${opts.companyName} · Cierre ${m.quarter}T ${m.year}`, S.title);
  put(wsRes, 2, 1, `Periodo ${slash(m.from)} – ${slash(m.to)}`, S.sub);
  const I = `'${N.ingresos}'`;
  const G = `'${N.gastos}'`;
  const Sa = `'${N.saldos}'`;
  const k = m.kpis;
  let r = 4;
  const sec = (txt: string) => {
    for (let c = 1; c <= 3; c++) put(wsRes, r, c, null, S.sec);
    put(wsRes, r, 1, txt, S.sec);
    r++;
  };
  const lin = (label: string, formula: string, value: number, style: Style = S.eur, note = "") => {
    put(wsRes, r, 1, label, S.txtL);
    put(wsRes, r, 2, f(formula, value), style);
    if (note) put(wsRes, r, 3, note, S.sub);
    r++;
  };
  sec("INGRESOS");
  lin("Base imponible facturada", `SUM(${I}!E2:E${li})`, k.ing_base);
  lin("IVA repercutido", `SUM(${I}!F2:F${li})`, k.ing_iva, S.eur, k.ing_iva ? "" : "Asistencia sanitaria exenta (art. 20 LIVA)");
  lin("Total facturado", `SUM(${I}!H2:H${li})`, k.ing_total);
  lin("Nº de facturas", `COUNTA(${I}!B2:B${li})`, k.ing_n, S.int);
  lin("   de las cuales abonos / rectificativas", `COUNTIF(${I}!H2:H${li},"<0")`, k.ing_abonos_n, S.int);
  lin("   importe de abonos (ya descontado)", `SUMIF(${I}!H2:H${li},"<0")`, k.ing_abonos);
  r++;
  sec("GASTOS (sin nóminas ni Seguridad Social)");
  lin("Base imponible de gastos", `SUM(${G}!G2:G${fin})`, k.gas_base);
  lin("IVA soportado", `SUM(${G}!H2:H${fin})`, k.gas_iva);
  lin("Retenciones profesionales (Mod. 111)", `SUM(${G}!K2:K${fin})`, k.gas_ret);
  lin("Total gastos (neto de retenciones)", `SUM(${G}!L2:L${fin})`, k.gas_total);
  lin("Nº de líneas de gasto", `COUNTA(${G}!B2:B${fin})`, k.gas_n, S.int);
  r++;
  sec("RESULTADO PROVISIONAL");
  lin("Ingresos (base) − Gastos (base)", `SUM(${I}!E2:E${li})-SUM(${G}!G2:G${fin})`, k.resultado, S.eurB,
    "Antes de nóminas, Seguridad Social y retribución de la socia (75 %): lo completa el asesor.");
  r++;
  sec(`SALDOS DE PACIENTES a ${m.saldosDate ? slash(m.saldosDate) : "—"}`);
  lin(`Acreedores (${k.sal_acre_n} pacientes)`, `SUMIF(${Sa}!E2:E${lastSal},">0")`, k.sal_acre);
  lin(`Deudores (${k.sal_deu_n} pacientes)`, `SUMIF(${Sa}!E2:E${lastSal},"<0")`, k.sal_deu);
  lin("Saldo neto", `SUM(${Sa}!E2:E${lastSal})`, k.sal_neto, S.eurB);
  r++;
  sec("PENDIENTE DEL ASESOR");
  for (const txt of [
    "Nóminas y Seguridad Social del trimestre.",
    "Retribución de la socia propietaria de la SLP (75 % de los ingresos netos).",
    `Retenciones de trabajadores (Mod. 111): celda amarilla de la hoja «${N.gastos}».`,
  ]) {
    put(wsRes, r, 1, `• ${txt}`, S.txtL);
    r++;
  }
  wsRes.views = [{ showGridLines: false }];
  wb.views = [{ x: 0, y: 0, width: 25600, height: 19020, firstSheet: 0, activeTab: 3, visibility: "visible" }];

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
