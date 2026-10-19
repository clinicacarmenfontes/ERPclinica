import { createHash } from "node:crypto";
import { COMPANY } from "@/lib/company";

// Excel trimestral del gestor: de los datos de erp.fn_gestor_export_data al
// contenido de cada hoja, los totales y los controles de calidad. Réplica del
// generador anterior (contabilidad/excel.py + validar.py): mismas hojas,
// columnas, orden de filas y totales.

// ── Entrada (JSON de fn_gestor_export_data) ────────────────────────────────

type Num = number | string;

export type ExportData = {
  year: number;
  quarter: number;
  from: string;
  to: string;
  ingresos: {
    invoice_id: string;
    line_no: number;
    source: string;
    /** paciente | cliente…: los pacientes van primero (listado de Optimydent). */
    kind: string;
    fecha: string;
    numero: string;
    doc: string | null;
    razon: string;
    cp: string | null;
    base: Num;
    impuestos: Num;
    forma_pago: string | null;
    fecha_pago: string | null;
  }[];
  gastos: {
    invoice_id: string;
    line_no: number;
    source: string;
    /** Facturas con retención (doctoras): van al final, como en el Excel anterior. */
    con_retencion: boolean;
    fecha: string;
    factura: string;
    cif: string | null;
    razon: string;
    tipo_gasto: string | null;
    forma_pago: string | null;
    base: Num;
    impuestos: Num;
    vat_rate: Num;
    exento: string | null;
    tasa_ret: Num;
    retencion: Num;
    asiento: string | null;
  }[];
  saldos: {
    acreedores_as_of: string | null;
    deudores_as_of: string | null;
    lines: { nombre: string; doc: string | null; telefono: string | null; cp: string | null; saldo: Num }[];
  };
  controles: {
    revision: number;
    conflictos: number;
    cerrado: boolean;
    emitidas_hasta: string | null;
    gastos_hasta: string | null;
  };
};

// ── Salida ─────────────────────────────────────────────────────────────────

export type IngresoRow = {
  fecha: string;
  numero: string;
  doc: string;
  razon: string;
  base: number;
  impuestos: number;
  cantidad: number;
  forma_pago: string;
  fecha_pago: string | null;
  cp: number | null;
};

export type GastoRow = {
  fecha: string;
  factura: string;
  cif: string;
  razon: string;
  tipo_gasto: string;
  forma_pago: string;
  base: number;
  impuestos: number;
  tipo_impuesto: string;
  tasa_ret: number;
  retencion: number;
  cantidad: number;
  asiento: number | null;
};

export type SaldoRow = { nombre: string; doc: string; telefono: number | null; cp: number | null; saldo: number };

export type CheckLevel = "error" | "aviso" | "info" | "ok";
export type Check = { id: string; level: CheckLevel; title: string; detail?: string; items: string[] };

export type Kpis = {
  ing_n: number;
  ing_base: number;
  ing_iva: number;
  ing_total: number;
  ing_abonos_n: number;
  ing_abonos: number;
  gas_n: number;
  gas_base: number;
  gas_iva: number;
  gas_ret: number;
  gas_total: number;
  sal_acre_n: number;
  sal_acre: number;
  sal_deu_n: number;
  sal_deu: number;
  sal_neto: number;
  resultado: number;
};

export type GestorModel = {
  year: number;
  quarter: number;
  from: string;
  to: string;
  saldosDate: string | null;
  ingresos: IngresoRow[];
  gastos: GastoRow[];
  saldos: SaldoRow[];
  kpis: Kpis;
  checks: Check[];
  /** Huella del contenido: si cambia, hay datos nuevos desde la última versión. */
  fingerprint: string;
};

// ── Utilidades ─────────────────────────────────────────────────────────────

const cents = (v: Num) => Math.round(Number(v) * 100);
const eur = (c: number) => c / 100;
const sumC = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
/** Comparación por código de carácter, como sorted() de Python (no localeCompare). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const toInt = (s: string | null): number | null => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

const FORMAS_PAGO = new Set(["Tarjeta", "Metálico", "Transferencia bancaria", "Financiado", "Fraccionado", "Recibo domiciliado"]);

/** Etiqueta de Optimydent: 0.21 → "IVA 21%(21,00%)"; exento → "Exento(0,00%)". */
export function vatLabel(rate: number, exento: string | null): string {
  if (!rate) return exento && /\(\d+,\d{2}%\)$/.test(exento) ? exento : "Exento(0,00%)";
  const pct = Math.round(rate * 10000) / 100;
  const shown = Number.isInteger(pct) ? String(pct) : String(pct).replace(".", ",");
  return `IVA ${shown}%(${pct.toFixed(2).replace(".", ",")}%)`;
}

const fmtEur = (c: number) =>
  `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** DNI/NIE con letra de control: true/false; null si es otro documento (CIF, pasaporte…). */
export function nifValido(doc: string): boolean | null {
  const d = doc.toUpperCase().replace(/-/g, "");
  const letras = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (/^\d{8}[A-Z]$/.test(d)) return letras[Number(d.slice(0, 8)) % 23] === d[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(d)) return letras[(Number("XYZ".indexOf(d[0]) + d.slice(1, 8))) % 23] === d[8];
  return null;
}

// ── Construcción ───────────────────────────────────────────────────────────

export function buildGestorModel(data: ExportData): GestorModel {
  // Ingresos: facturas a pacientes (fecha y nº descendentes, como el listado
  // de Optimydent) y después las facturas a otras clínicas por fecha. Se decide
  // por el tipo de cliente y no por el origen: una factura corregida en el ERP
  // sigue siendo de un paciente.
  const natural = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });
  const ingOpt = data.ingresos
    .filter((r) => r.kind === "paciente")
    .sort((a, b) => cmp(b.fecha, a.fecha) || natural(b.numero, a.numero) || a.line_no - b.line_no);
  const ingOtr = data.ingresos
    .filter((r) => r.kind !== "paciente")
    .sort((a, b) => cmp(a.fecha, b.fecha) || natural(a.numero, b.numero) || a.line_no - b.line_no);
  const ingresos: IngresoRow[] = [...ingOpt, ...ingOtr].map((r) => ({
    fecha: r.fecha,
    numero: r.numero,
    doc: r.doc ?? "",
    razon: r.razon,
    base: eur(cents(r.base)),
    impuestos: eur(cents(r.impuestos)),
    cantidad: eur(cents(r.base) + cents(r.impuestos)),
    forma_pago: r.forma_pago ?? "",
    fecha_pago: r.fecha_pago,
    cp: toInt(r.cp),
  }));

  // Gastos: proveedores por (fecha, razón social, factura); después las
  // facturas con retención (doctoras) por (razón social, fecha).
  const gasOpt = data.gastos
    .filter((r) => !r.con_retencion)
    .sort((a, b) => cmp(a.fecha, b.fecha) || cmp(a.razon.toLowerCase(), b.razon.toLowerCase()) || cmp(a.factura, b.factura) || a.line_no - b.line_no);
  const gasOtr = data.gastos
    .filter((r) => r.con_retencion)
    .sort((a, b) => cmp(a.razon.toLowerCase(), b.razon.toLowerCase()) || cmp(a.fecha, b.fecha) || a.line_no - b.line_no);
  const gastos: GastoRow[] = [...gasOpt, ...gasOtr].map((r) => {
    const base = cents(r.base);
    const vat = cents(r.impuestos);
    const ret = cents(r.retencion);
    return {
      fecha: r.fecha,
      factura: r.factura,
      cif: r.cif ?? "",
      razon: r.razon,
      tipo_gasto: r.tipo_gasto ?? "",
      forma_pago: r.forma_pago ?? "",
      base: eur(base),
      impuestos: eur(vat),
      tipo_impuesto: vatLabel(Number(r.vat_rate), r.exento),
      tasa_ret: Number(r.tasa_ret),
      retencion: eur(ret),
      cantidad: eur(base + vat - ret),
      asiento: toInt(r.asiento),
    };
  });

  const saldos: SaldoRow[] = data.saldos.lines
    .map((r) => ({
      nombre: r.nombre,
      doc: r.doc ?? "",
      telefono: toInt(r.telefono),
      cp: toInt(r.cp),
      saldo: eur(cents(r.saldo)),
    }))
    .sort((a, b) => b.saldo - a.saldo || cmp(a.nombre, b.nombre));

  const acre = saldos.filter((s) => s.saldo > 0);
  const deu = saldos.filter((s) => s.saldo < 0);
  const c = (rows: { [k: string]: unknown }[], k: string) => sumC(rows.map((r) => cents(r[k] as number)));
  const kpis: Kpis = {
    ing_n: ingresos.length,
    ing_base: eur(c(ingresos, "base")),
    ing_iva: eur(c(ingresos, "impuestos")),
    ing_total: eur(c(ingresos, "cantidad")),
    ing_abonos_n: ingresos.filter((r) => r.cantidad < 0).length,
    ing_abonos: eur(c(ingresos.filter((r) => r.cantidad < 0), "cantidad")),
    gas_n: gastos.length,
    gas_base: eur(c(gastos, "base")),
    gas_iva: eur(c(gastos, "impuestos")),
    gas_ret: eur(c(gastos, "retencion")),
    gas_total: eur(c(gastos, "cantidad")),
    sal_acre_n: acre.length,
    sal_acre: eur(c(acre, "saldo")),
    sal_deu_n: deu.length,
    sal_deu: eur(c(deu, "saldo")),
    sal_neto: eur(c(saldos, "saldo")),
    resultado: eur(c(ingresos, "base") - c(gastos, "base")),
  };

  const asOf = [data.saldos.acreedores_as_of, data.saldos.deudores_as_of].filter((d): d is string => !!d).sort();
  const model: Omit<GestorModel, "fingerprint" | "checks"> = {
    year: data.year,
    quarter: data.quarter,
    from: data.from,
    to: data.to,
    saldosDate: asOf[asOf.length - 1] ?? null,
    ingresos,
    gastos,
    saldos,
    kpis,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ingresos, gastos, saldos, saldosDate: model.saldosDate }))
    .digest("hex");
  return { ...model, checks: buildChecks(data, model), fingerprint };
}

// ── Controles de calidad (error = bloquea la generación) ──────────────────

function check(id: string, level: CheckLevel, title: string, items: string[] = [], detail?: string): Check {
  return { id, level, title, detail, items };
}

function buildChecks(data: ExportData, m: Omit<GestorModel, "fingerprint" | "checks">): Check[] {
  const out: Check[] = [];
  const { ingresos, gastos } = m;
  const k = data.controles;

  // Documentos y cobertura
  const faltan: string[] = [];
  if (!ingresos.length) faltan.push("No hay facturas emitidas en el trimestre.");
  if (!gastos.length) faltan.push("No hay gastos en el trimestre.");
  if (!data.saldos.acreedores_as_of) faltan.push("Falta el listado de pacientes ACREEDORES (desde el inicio del trimestre hasta 60 días después del cierre).");
  if (!data.saldos.deudores_as_of) faltan.push("Falta el listado de pacientes DEUDORES (desde el inicio del trimestre hasta 60 días después del cierre).");
  out.push(check("datos", faltan.length ? "error" : "ok", "Datos del trimestre cargados", faltan));

  const cobertura: string[] = [];
  if (!k.emitidas_hasta || k.emitidas_hasta < data.to) {
    cobertura.push(`Facturas emitidas cargadas hasta ${k.emitidas_hasta ? fmtDate(k.emitidas_hasta) : "—"}; el trimestre acaba el ${fmtDate(data.to)}.`);
  }
  if (!k.gastos_hasta || k.gastos_hasta < data.to) {
    cobertura.push(`Gastos cargados hasta ${k.gastos_hasta ? fmtDate(k.gastos_hasta) : "—"}; el trimestre acaba el ${fmtDate(data.to)}.`);
  }
  out.push(
    check("cobertura", cobertura.length ? "aviso" : "ok", "Listados que cubren el trimestre completo", cobertura,
      cobertura.length ? "Si en los últimos días no hubo facturas es correcto; si no, sube el listado completo." : undefined),
  );

  out.push(
    check("revision", k.revision ? "aviso" : "ok", "Facturas del trimestre sin avisos pendientes",
      k.revision ? [`${k.revision} factura(s) marcadas para revisar (pantalla Revisión).`] : []),
  );
  out.push(
    check("conflictos", k.conflictos ? "aviso" : "ok", "Sin conflictos de sincronización pendientes",
      k.conflictos ? [`${k.conflictos} conflicto(s) por resolver en Sincronización.`] : []),
  );

  // Ingresos
  const porNumero = new Map<string, Set<string>>();
  for (const r of data.ingresos) {
    const s = porNumero.get(r.numero) ?? new Set<string>();
    s.add(r.invoice_id);
    porNumero.set(r.numero, s);
  }
  const dup = [...porNumero].filter(([, s]) => s.size > 1).map(([n, s]) => `${n} (×${s.size})`);
  out.push(check("ing-dup", dup.length ? "error" : "ok", "Sin números de factura emitida duplicados", dup));

  const series = new Map<string, number[]>();
  const raras: string[] = [];
  for (const r of data.ingresos.filter((x) => x.kind === "paciente" && x.line_no === 1)) {
    const mm = /^([A-Za-z]+)(\d+)\/(\d{4})$/.exec(r.numero);
    if (!mm) {
      raras.push(`Número con formato inesperado: ${r.numero}`);
      continue;
    }
    const key = `${mm[1]}|${mm[3]}`;
    series.set(key, [...(series.get(key) ?? []), Number(mm[2])]);
  }
  const huecos: string[] = [];
  const resumen: string[] = [];
  for (const [key, nums] of [...series].sort(([a], [b]) => cmp(a, b))) {
    const [serie, anio] = key.split("|");
    const set = new Set(nums);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    for (let n = min; n <= max; n++) if (!set.has(n)) huecos.push(`Falta ${serie}${String(n).padStart(4, "0")}/${anio}`);
    resumen.push(`${serie}: ${min}–${max} (${nums.length})`);
  }
  out.push(
    check("ing-huecos", huecos.length || raras.length ? "aviso" : "ok", "Numeración correlativa sin huecos", [...huecos, ...raras],
      `${huecos.length ? "Faltan números dentro de la serie (¿facturas anuladas o sin exportar?). " : ""}Series: ${resumen.join(" · ") || "—"}`),
  );

  const fuera = ingresos.filter((r) => r.fecha < data.from || r.fecha > data.to).map((r) => `${r.numero} con fecha ${fmtDate(r.fecha)}`);
  out.push(check("ing-fechas", fuera.length ? "error" : "ok", "Fechas de factura dentro del trimestre", fuera));

  const sinDoc = ingresos.filter((r) => !r.doc).map((r) => `${r.numero} · ${r.razon}`);
  out.push(check("ing-sindoc", sinDoc.length ? "aviso" : "ok", "Todas las facturas emitidas tienen documento de identificación", sinDoc));

  const nifMal = ingresos.filter((r) => r.doc && nifValido(r.doc) === false).map((r) => `${r.numero} · ${r.razon} · ${r.doc}`);
  if (nifMal.length) {
    out.push(check("ing-nif", "info", "Documentos con letra de control incorrecta", nifMal,
      "Puede ser un error de tecleo en la ficha del paciente (no afecta a los importes)."));
  }

  const pagoRaro = ingresos.filter((r) => !FORMAS_PAGO.has(r.forma_pago)).map((r) => `${r.numero}: «${r.forma_pago || "sin forma de pago"}»`);
  out.push(check("ing-pago", pagoRaro.length ? "aviso" : "ok", "Formas de pago reconocidas", pagoRaro));

  const conIva = ingresos.filter((r) => r.impuestos);
  out.push(
    check("ing-iva", "info", conIva.length ? "Facturas emitidas con IVA" : "Todas las facturas emitidas exentas de IVA",
      conIva.map((r) => `${r.numero}: IVA ${fmtEur(cents(r.impuestos))}`),
      conIva.length ? undefined : "Asistencia sanitaria exenta (art. 20 LIVA)."),
  );
  const abonos = ingresos.filter((r) => r.cantidad < 0);
  if (abonos.length) {
    out.push(check("ing-abonos", "info", `${abonos.length} abono(s) por ${fmtEur(sumC(abonos.map((r) => cents(r.cantidad))))} (restan del total)`,
      abonos.map((r) => `${r.numero} · ${r.razon} · ${fmtEur(cents(r.cantidad))}`)));
  }

  // Gastos
  const ivaMal = data.gastos
    .filter((r) => Number(r.vat_rate) && Math.abs(Math.round(cents(r.base) * Number(r.vat_rate)) - cents(r.impuestos)) > 1)
    .map((r) => `${r.razon} · ${r.factura}: IVA ${fmtEur(cents(r.impuestos))} ≠ ${Math.round(Number(r.vat_rate) * 100)} % de ${fmtEur(cents(r.base))}`);
  out.push(check("gas-iva", ivaMal.length ? "aviso" : "ok", "IVA coherente con el tipo impositivo", ivaMal));

  const gFuera = gastos.filter((r) => r.fecha < data.from || r.fecha > data.to).map((r) => `${r.razon} · ${r.factura} · ${fmtDate(r.fecha)}`);
  out.push(check("gas-fechas", gFuera.length ? "error" : "ok", "Fechas de gasto dentro del trimestre", gFuera));

  const sinAsiento = gastos.filter((r) => r.asiento === null).map((r) => `${r.razon} · ${r.factura} · tipo «${r.tipo_gasto || "sin tipo"}»`);
  out.push(check("gas-asiento", sinAsiento.length ? "aviso" : "ok", "Todas las líneas de gasto tienen cuenta contable", sinAsiento,
    sinAsiento.length ? "Asigna cuenta al tipo de gasto en Configuración, o el asesor la completa." : undefined));

  const sinCif = gastos.filter((r) => !r.cif).map((r) => `${r.razon} · ${r.factura}`);
  out.push(check("gas-cif", sinCif.length ? "aviso" : "ok", "Todos los proveedores tienen CIF/NIF", sinCif));

  const propio = gastos.filter((r) => r.cif === COMPANY.taxId).map((r) => `${r.razon} · ${r.factura}`);
  out.push(check("gas-cifpropio", propio.length ? "aviso" : "ok", "Ningún proveedor con el CIF de la propia clínica", propio));

  const porProveedor = new Map<string, Set<string>>();
  for (const r of gastos.filter((x) => x.factura && !/^[-\s]*$/.test(x.factura))) {
    const key = `${r.cif || r.razon.toLowerCase()}|${r.factura}`;
    porProveedor.set(key, (porProveedor.get(key) ?? new Set<string>()).add(r.fecha));
  }
  const repetidos = [...porProveedor]
    .filter(([, f]) => f.size > 1)
    .map(([key, f]) => `${key.split("|")[1]} (${[...f].sort().map(fmtDate).join(", ")})`);
  out.push(check("gas-numrep", repetidos.length ? "aviso" : "ok", "Mismo nº de factura con fechas distintas", repetidos));

  const negativos = gastos.filter((r) => r.cantidad < 0);
  if (negativos.length) {
    out.push(check("gas-abonos", "info", `${negativos.length} línea(s) de gasto negativas (abonos)`,
      negativos.map((r) => `${r.razon} · ${r.factura} · ${fmtEur(cents(r.cantidad))}`)));
  }

  // Doctoras con retención: un mes sin factura puede ser vacaciones o un olvido.
  const meses = [0, 1, 2].map((i) => `${data.from.slice(0, 4)}-${String(Number(data.from.slice(5, 7)) + i).padStart(2, "0")}`);
  const porPro = new Map<string, Set<string>>();
  for (const r of gastos.filter((x) => x.retencion > 0)) {
    porPro.set(r.razon, (porPro.get(r.razon) ?? new Set<string>()).add(r.fecha.slice(0, 7)));
  }
  const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const sinFactura = [...porPro].flatMap(([nombre, ms]) =>
    meses.filter((mm) => !ms.has(mm)).map((mm) => `${nombre}: sin factura de ${MES[Number(mm.slice(5, 7)) - 1]}`),
  );
  out.push(
    check("pro-meses", sinFactura.length ? "info" : "ok",
      porPro.size ? "Cobertura mensual de las doctoras con retención" : "Sin facturas de doctoras con retención en el trimestre",
      sinFactura, porPro.size ? undefined : "Si este trimestre hubo doctoras con retención, contabiliza sus facturas desde Repositorio."),
  );

  // Saldos
  const sinDocSaldo = m.saldos.filter((s) => !s.doc).map((s) => s.nombre);
  if (sinDocSaldo.length) out.push(check("sal-doc", "info", "Pacientes con saldo sin documento de identificación", sinDocSaldo));

  if (k.cerrado) out.push(check("cerrado", "info", "El trimestre está cerrado", [], "Los datos ya no cambian salvo que lo reabras."));
  return out;
}
