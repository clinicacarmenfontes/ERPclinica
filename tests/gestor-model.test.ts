import { describe, expect, it } from "vitest";
import { buildGestorModel, nifValido, vatLabel, type ExportData } from "@/lib/gestor/model";
import { verifyGestorXlsx } from "@/lib/gestor/verify";
import { writeGestorXlsx } from "@/lib/gestor/xlsx";
import { readXlsxSheets } from "@/lib/ingest/parsers/xlsx";

const ing = (over: Partial<ExportData["ingresos"][number]>): ExportData["ingresos"][number] => ({
  invoice_id: over.numero ?? "x",
  line_no: 1,
  source: "optimydent",
  kind: "paciente",
  fecha: "2026-09-30",
  numero: "P0001/2026",
  doc: "26896154T",
  razon: "Paciente",
  cp: "46025",
  base: 200,
  impuestos: 0,
  forma_pago: "Tarjeta",
  fecha_pago: "2026-09-30",
  ...over,
});
const gas = (over: Partial<ExportData["gastos"][number]>): ExportData["gastos"][number] => ({
  invoice_id: over.factura ?? "g",
  line_no: 1,
  source: "optimydent",
  con_retencion: false,
  fecha: "2026-07-01",
  factura: "F-1",
  cif: "B97118640",
  razon: "FINANDREU SL",
  tipo_gasto: "Alquiler Local",
  forma_pago: "Recibo domiciliado",
  base: 1221.23,
  impuestos: 256.46,
  vat_rate: 0.21,
  exento: null,
  tasa_ret: 0,
  retencion: 0,
  asiento: "62100000",
  ...over,
});

const data = (over: Partial<ExportData> = {}): ExportData => ({
  year: 2026,
  quarter: 3,
  from: "2026-07-01",
  to: "2026-09-30",
  ingresos: [
    ing({ numero: "P0001/2026", fecha: "2026-07-01" }),
    ing({ numero: "P0003/2026", fecha: "2026-09-30" }),
    ing({ numero: "P0002/2026", fecha: "2026-09-30", base: -50 }),
    ing({ numero: "07/2026", kind: "cliente", source: "pdf_emitida", doc: "26745391W", razon: "Clínica X", cp: null, forma_pago: "Transferencia bancaria", fecha_pago: null }),
  ],
  gastos: [
    gas({ factura: "F-2", fecha: "2026-08-01", razon: "zeta", base: 10, impuestos: 2.1 }),
    gas({ factura: "F-1" }),
    gas({ factura: "23", con_retencion: true, source: "manual", razon: "Doctora", cif: "48435440Q", tipo_gasto: "Prestación servicios profesionales", base: 656, impuestos: 0, vat_rate: 0, exento: "Exento(0,00%)", tasa_ret: 0.15, retencion: 98.4, asiento: "62300000", forma_pago: "Transferencia bancaria" }),
  ],
  saldos: {
    acreedores_as_of: "2026-10-06",
    deudores_as_of: "2026-10-06",
    lines: [
      { nombre: "B", doc: "1", telefono: "600000000", cp: "46000", saldo: 10 },
      { nombre: "A", doc: "2", telefono: null, cp: null, saldo: -5 },
      { nombre: "C", doc: "3", telefono: null, cp: null, saldo: 99 },
    ],
  },
  controles: { revision: 0, conflictos: 0, cerrado: false, emitidas_hasta: "2026-09-30", gastos_hasta: "2026-09-30" },
  ...over,
});

describe("modelo del Excel del gestor", () => {
  it("ordena como el Excel anterior: pacientes por fecha y nº descendentes, luego otras clínicas; doctoras al final", () => {
    const m = buildGestorModel(data());
    expect(m.ingresos.map((r) => r.numero)).toEqual(["P0003/2026", "P0002/2026", "P0001/2026", "07/2026"]);
    expect(m.gastos.map((g) => g.factura)).toEqual(["F-1", "F-2", "23"]);
    expect(m.saldos.map((s) => s.nombre)).toEqual(["C", "B", "A"]);
    expect(m.gastos[2]).toMatchObject({ retencion: 98.4, cantidad: 557.6, tipo_impuesto: "Exento(0,00%)" });
  });

  it("totales en céntimos exactos", () => {
    const k = buildGestorModel(data()).kpis;
    expect(k).toMatchObject({
      ing_n: 4,
      ing_base: 550,
      ing_abonos_n: 1,
      ing_abonos: -50,
      gas_base: 1887.23,
      gas_iva: 258.56,
      gas_ret: 98.4,
      gas_total: 2047.39,
      sal_acre: 109,
      sal_deu: -5,
      sal_neto: 104,
    });
  });

  it("etiquetas de IVA de Optimydent y letra del DNI/NIE", () => {
    expect([vatLabel(0.21, null), vatLabel(0.1, null), vatLabel(0.04, null), vatLabel(0, null), vatLabel(0.19, null)]).toEqual([
      "IVA 21%(21,00%)", "IVA 10%(10,00%)", "IVA 4%(4,00%)", "Exento(0,00%)", "IVA 19%(19,00%)",
    ]);
    expect([nifValido("26896154T"), nifValido("26896154A"), nifValido("X1184575Y"), nifValido("X1184575A"), nifValido("B97118640")]).toEqual([true, false, true, false, null]);
  });

  it("sin listado de saldos o con fechas fuera del trimestre → bloquea", () => {
    const m = buildGestorModel(data({ saldos: { acreedores_as_of: null, deudores_as_of: "2026-10-06", lines: [] } }));
    expect(m.checks.find((c) => c.id === "datos")?.level).toBe("error");
    const fuera = buildGestorModel(data({ gastos: [gas({ fecha: "2026-10-01" })] }));
    expect(fuera.checks.find((c) => c.id === "gas-fechas")?.level).toBe("error");
  });

  it("avisa de huecos en la numeración y de facturas pendientes de revisar", () => {
    const m = buildGestorModel(data({ controles: { ...data().controles, revision: 2 } }));
    expect(m.checks.find((c) => c.id === "ing-huecos")?.level).toBe("ok");
    const hueco = buildGestorModel(data({ ingresos: [ing({ numero: "P0001/2026" }), ing({ numero: "P0004/2026" })] }));
    expect(hueco.checks.find((c) => c.id === "ing-huecos")?.items).toEqual(["Falta P0002/2026", "Falta P0003/2026"]);
    expect(m.checks.find((c) => c.id === "revision")?.level).toBe("aviso");
  });

  it("la huella cambia si cambia cualquier dato", () => {
    const a = buildGestorModel(data()).fingerprint;
    expect(buildGestorModel(data()).fingerprint).toBe(a);
    expect(buildGestorModel(data({ gastos: [gas({ base: 1221.24 })] })).fingerprint).not.toBe(a);
  });
});

describe("Excel del gestor generado", () => {
  it("se relee y cuadra celda a celda; hojas en el orden de siempre", async () => {
    const m = buildGestorModel(data());
    const bytes = await writeGestorXlsx(m, { companyName: "Dental Fontes Lluch SLP" });
    const v = verifyGestorXlsx(bytes, m);
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
    expect(readXlsxSheets(bytes).map((s) => s.name)).toEqual([
      "Saldos pacientes 06102026", "Ingresos 3Q 2026", "Gastos 3Q 2026", "Resumen 3Q 2026",
    ]);
  });

  it("la verificación detecta un fichero que no corresponde a los datos", async () => {
    const m = buildGestorModel(data());
    const bytes = await writeGestorXlsx(m, { companyName: "Dental Fontes Lluch SLP" });
    const otro = buildGestorModel(data({ gastos: [gas({ factura: "F-1", base: 1300 })] }));
    const v = verifyGestorXlsx(bytes, otro);
    expect(v.ok).toBe(false);
    expect(v.mismatches.join(" ")).toMatch(/Gastos 3Q 2026!G2/);
  });
});
