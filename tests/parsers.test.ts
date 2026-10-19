import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "@/lib/ingest/parsers";
import { parseCaixaBankCsv } from "@/lib/ingest/parsers/banks";
import { parseGastos, SPEC_GASTOS } from "@/lib/ingest/parsers/optimydent";
import { readOptimydentTable } from "@/lib/ingest/parsers/optimydent-table";
import type { PdfPage, PdfWord } from "@/lib/ingest/parsers/pdf";
import { DocumentFormatError, type ParsedDocument } from "@/lib/ingest/types";
import { buildXlsx } from "./helpers/xlsx";

// Ficheros reales de 3T2026 en tests/fixtures/private/ (fuera del repositorio:
// tienen datos de pacientes y bancos). Sin ellos, estos tests se saltan.
const PRIVATE = join(__dirname, "fixtures", "private");
const fixture = (name: string) => new Uint8Array(readFileSync(join(PRIVATE, name)));
const hasPrivate = existsSync(join(PRIVATE, "optimydent-gastos-3T2026.pdf"));
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x * 100, 0)) / 100;

function expectKind<K extends ParsedDocument["kind"]>(doc: ParsedDocument, kind: K) {
  expect(doc.kind).toBe(kind);
  return doc as Extract<ParsedDocument, { kind: K }>;
}

describe("CaixaBank CSV (sintético)", () => {
  const csv = [
    "Concepto;Fecha;Importe;Saldo",
    "ORMCO B.V;28/09/2026;-859,10EUR;15.483,04EUR",
    "ORMCO B.V;28/09/2026;-859,10EUR;16.342,14EUR",
    "TRANSFER INMEDIATA;27/09/2026;+5000,00EUR;17.201,24EUR",
    "SEGURCAIXA S.A.;26/09/2026;-39,74EUR;12.201,24EUR",
  ].join("\n");

  it("invierte a orden cronológico y valida la cadena de saldos", () => {
    const doc = expectKind(parseCaixaBankCsv(csv), "movimientos_banco");
    expect(doc.transactions.map((t) => t.amount)).toEqual([-39.74, 5000, -859.1, -859.1]);
    expect(doc.transactions[0].balance_after).toBe(12201.24);
    expect([doc.coversFrom, doc.coversTo]).toEqual(["2026-09-26", "2026-09-28"]);
  });

  it("rechaza el fichero entero si un saldo no cuadra", () => {
    expect(() => parseCaixaBankCsv(csv.replace("16.342,14", "16.342,15"))).toThrow(DocumentFormatError);
  });
});

describe.skipIf(!hasPrivate)("ficheros reales 3T2026", () => {
  it("Gastos de Optimydent: cuadra con el Excel del gestor tras las 4 líneas que se excluyeron a mano", async () => {
    const doc = expectKind(await parseDocument(fixture("optimydent-gastos-3T2026.pdf"), { asOf: "2026-10-06" }), "optimydent_gastos");
    const inv = doc.invoices;
    // Excel v2: 159 líneas = 150 de Optimydent + 9 de doctoras con retención.
    // La app local excluyó a mano 4 líneas (2.110,88 €, IVA 361,91 €): el
    // listado bruto tiene 154.
    expect(doc.sourceRows).toBe(154);
    expect(sum(inv.map((i) => i.total))).toBe(sum([61824.83, 2110.88]));
    expect(sum(inv.map((i) => i.vat_total))).toBe(sum([5083.41, 361.91]));
    expect(sum(inv.map((i) => i.base_total))).toBe(sum([56741.42, 2110.88 - 361.91]));
    for (const i of inv) {
      expect(sum(i.lines.map((l) => l.base))).toBe(i.base_total);
      expect(Math.round((i.base_total + i.vat_total - i.withholding_total) * 100)).toBe(Math.round(i.total * 100));
    }
    const fin = inv.find((i) => i.invoice_number === "2026/170");
    expect(fin).toMatchObject({ issuer_tax_id: "B97118640", expense_type: "Alquiler Local", total: 1477.69 });
    expect([doc.coversFrom, doc.coversTo]).toEqual(["2026-07-01", "2026-09-30"]);

    // Lo que en la app local hubo que corregir a mano, aquí sale marcado para revisión:
    const dup = inv.find((i) => i.invoice_number === "CS26/381")!;
    expect(dup.review_reasons).toContain("linea_repetida_en_origen");
    const ownCif = inv.filter((i) => i.issuer_tax_id === "B67717082");
    expect(ownCif.length).toBeGreaterThanOrEqual(3);
    expect(ownCif.every((i) => i.review_reasons.includes("nif_emisor_es_la_clinica"))).toBe(true);
  });

  it("Facturas emitidas: 462 de Optimydent (el Excel suma 4 más, emitidas a otra clínica)", async () => {
    const doc = expectKind(
      await parseDocument(fixture("optimydent-emitidas-3T2026.pdf"), { asOf: "2026-10-06" }),
      "optimydent_facturas_emitidas",
    );
    expect(doc.invoices).toHaveLength(462);
    expect(doc.invoices.filter((i) => i.total < 0)).toHaveLength(13);
    expect(sum(doc.invoices.filter((i) => i.total < 0).map((i) => i.total))).toBe(-9155.62);
    const p = doc.invoices.find((i) => i.invoice_number === "P1632/2026")!;
    expect(p).toMatchObject({ total: 200, status: "pagada", paid_at: "2026-09-30", issuer_tax_id: "B67717082" });
    expect(p.counterparty).toMatchObject({ kind: "paciente", tax_id: "26896154T" });
    expect(p.counterparty).not.toHaveProperty("clinical_record");
    expect(doc.invoices.every((i) => i.vat_total === 0)).toBe(true);
  });

  it("Saldos: acreedores 70 / deudores 23, mismos totales que el Excel", async () => {
    const a = expectKind(await parseDocument(fixture("optimydent-acreedores-3T2026.pdf"), { asOf: "2026-10-06" }), "optimydent_saldos_acreedores");
    const d = expectKind(await parseDocument(fixture("optimydent-deudores-3T2026.pdf"), { asOf: "2026-10-06" }), "optimydent_saldos_deudores");
    expect(a.lines).toHaveLength(70);
    expect(sum(a.lines.map((l) => l.balance))).toBe(124117.87);
    expect(d.lines).toHaveLength(23);
    expect(sum(d.lines.map((l) => l.balance))).toBe(-4582.15);
  });

  it("CaixaBank real: 82 movimientos, cadena de saldos íntegra, 3 cargos ORMCO iguales distinguidos", async () => {
    const doc = expectKind(await parseDocument(fixture("CaixaBank_digital_CaixaBankNow_20261018.csv"), { asOf: "x" }), "movimientos_banco");
    expect(doc.bank).toBe("caixabank");
    expect(doc.transactions).toHaveLength(82);
    const ormco = doc.transactions.filter((t) => t.booking_date === "2026-09-28" && t.amount === -859.1);
    expect(new Set(ormco.map((t) => t.balance_after)).size).toBe(3);
    expect(doc.transactions[doc.transactions.length - 1].balance_after).toBe(8751.38);
  });

  it("Kutxabank PDF: nº de cuenta, cadena de saldos íntegra y sin el apunte de 0,00 €", async () => {
    const doc = expectKind(await parseDocument(fixture("movimientos.pdf"), { asOf: "x" }), "movimientos_banco");
    expect(doc.bank).toBe("kutxabank");
    expect(doc.accountNumber).toBe("20950451209125084927");
    expect(doc.transactions[0]).toMatchObject({ booking_date: "2026-09-18", amount: 490, balance_after: 40841.61 });
    expect(doc.transactions.some((t) => t.amount === 0)).toBe(false);
    expect(doc.warnings.join()).toMatch(/0,00/);
    const last = doc.transactions[doc.transactions.length - 1];
    expect(last.balance_after).toBe(36617.42);
  });
});

describe("Optimydent: columnas elegidas a mano (sintético)", () => {
  // Página con cabecera #3f4c6b de 80 pt por columna y una fila por registro.
  function page(headers: string[], rows: string[][]): PdfPage {
    const W = 80;
    const rects = headers.map((_, i) => ({ x0: i * W, x1: (i + 1) * W, top: 10, bottom: 20, color: "#3f4c6b" }));
    const word = (text: string, col: number, top: number): PdfWord => ({
      text, x0: col * W + 2, x1: col * W + 2 + text.length * 3, top, bottom: top + 8, page: 1,
    });
    const words = [
      ...headers.flatMap((h, i) => h.split(" ").map((t, j) => ({ ...word(t, i, 11), x0: i * W + 2 + j * 15, x1: i * W + 14 + j * 15 }))),
      ...rows.flatMap((r, k) => r.map((t, i) => word(t, i, 30 + k * 12)).filter((w) => w.text)),
    ];
    return { number: 1, width: W * headers.length, height: 600, words, rects };
  }
  const headers = [
    "Fecha", "Email", "Razón social", "CIF", "Nota interna", "Tipo de gasto", "Factura", "Cantidad", "Impuestos",
    "Tipo de impuesto",
  ];
  const row = [
    "01/09/2026", "x@y.es", "ACME", "B12345678", "secreto", "Alquiler", "F-1", "121,00", "21,00", "IVA(21,00%)",
  ];

  it("admite columnas de más y en otro orden, sin conservar las que no van a BBDD", () => {
    const doc = expectKind(parseGastos(readOptimydentTable([page(headers, [row])], SPEC_GASTOS)), "optimydent_gastos");
    expect(doc.invoices).toHaveLength(1);
    expect(doc.invoices[0]).toMatchObject({ issuer_tax_id: "B12345678", invoice_number: "F-1", total: 121, vat_total: 21 });
    expect(doc.invoices[0]).toMatchObject({ expense_type: "Alquiler" });
    expect(doc.invoices[0].lines[0]).toMatchObject({ vat_rate: 0.21, account_code: null, description: null });
    expect(JSON.stringify(doc.invoices)).not.toMatch(/secreto|x@y/);
    expect(doc.warnings.join()).toMatch(/adicionales ignoradas: email, nota interna/);
    expect(doc.missingColumns).toEqual(["proveedor", "forma de pago", "concepto", "asiento contable"]);
  });

  it("rechaza el listado si falta una columna imprescindible", () => {
    const without = (col: number) => [headers.filter((_, i) => i !== col), row.filter((_, i) => i !== col)] as const;
    const [h, r] = without(headers.indexOf("Factura"));
    expect(() => parseGastos(readOptimydentTable([page(h, [r])], SPEC_GASTOS))).toThrow(/imprescindibles para la contabilidad: factura/);
  });
});

describe("Optimydent en Excel (sintético)", () => {
  const parse = (rows: (string | number | null)[][]) => parseDocument(buildXlsx(rows), { asOf: "2026-10-06" });

  const gastosHeader = [
    "Proveedor", "Razón social", "CIF", "Email", "Tipo de gasto", "Forma de pago", "Fecha", "Concepto", "Cantidad",
    "Impuestos", "Tipo de impuesto", "Factura",
  ];

  it("gastos: números y fechas del Excel, varias filas de una factura agrupadas, columnas extra fuera", async () => {
    const doc = expectKind(
      await parse([
        gastosHeader,
        ["FINANDREU SL", "FINANDREU SL", "B97118640", "a@b.es", "Alquiler Local", "Recibo domiciliado", "2026-09-01", "Alquiler", 1477.69, 256.46, "IVA 21%(21,00%)", "A-101"],
        ["DEPOSITO", "DEPOSITO DENTAL SL", "B11111111", null, "Compra Material Clínica", "Tarjeta", "2026-09-14", null, 121, 21, "IVA 21%", "F-7"],
        ["DEPOSITO", "DEPOSITO DENTAL SL", "B11111111", null, "Compra Material Clínica", "Tarjeta", "2026-09-14", null, 110, 10, "IVA 10%", "F-7"],
      ]),
      "optimydent_gastos",
    );
    expect(doc.invoices).toHaveLength(2);
    expect(doc.invoices[0]).toMatchObject({ issue_date: "2026-09-01", total: 1477.69, vat_total: 256.46, base_total: 1221.23 });
    const f7 = doc.invoices[1];
    expect(f7).toMatchObject({ invoice_number: "F-7", total: 231, vat_total: 31 });
    expect(f7.lines.map((l) => l.vat_rate)).toEqual([0.21, 0.1]);
    expect(JSON.stringify(doc)).not.toMatch(/a@b\.es/);
    expect(doc.warnings.join()).toMatch(/adicionales ignoradas: email/);
    expect(doc.missingColumns).toEqual(["asiento contable"]);
    expect(doc.summary).toMatch(/Excel/);
  });

  it("gastos: sin una columna imprescindible se rechaza diciendo cuál", async () => {
    const header = gastosHeader.filter((h) => h !== "Tipo de gasto");
    await expect(parse([header, ["X", "X SL", "B1", null, "Tarjeta", "2026-09-01", null, 10, 0, "Exento", "1"]])).rejects.toThrow(
      /imprescindibles para la contabilidad: tipo de gasto/,
    );
  });

  it("saldos: el nº de historia no se pide ni se guarda", async () => {
    const doc = expectKind(
      await parse([
        ["Nº Historia", "Nombre", "Documento de identificación", "Teléfono", "Saldo", "Próxima cita"],
        ["000890", "DAVID ROMERO", "11111111H", 664432918, 3189, "2026-09-30"],
        ["000903", "ANA MARTINEZ", "22222222J", null, 511.5, null],
      ]),
      "optimydent_saldos_acreedores",
    );
    expect(doc.lines).toEqual([
      { tax_id: "11111111H", name: "DAVID ROMERO", phone: "664432918", postal_code: null, balance: 3189 },
      { tax_id: "22222222J", name: "ANA MARTINEZ", phone: null, postal_code: null, balance: 511.5 },
    ]);
    expect(doc.warnings.join()).toMatch(/adicionales ignoradas: no historia, proxima cita/);
  });

  it("emitidas: sin fecha de pago se rechaza (sin ella todas saldrían pendientes)", async () => {
    await expect(
      parse([
        ["Fecha factura", "Número", "Razón social", "Doc. Ident.", "Base imponible", "Impuestos", "Total"],
        ["2026-09-24", "P1607/2026", "CARLOTA DOIRO", "44877357X", 180, 0, 180],
      ]),
    ).rejects.toThrow(/imprescindibles para la contabilidad: fecha de pago/);
  });

  it("emitidas: fila con importes que no cuadran → error con el nº de fila", async () => {
    await expect(
      parse([
        ["Fecha factura", "Número", "Razón social", "Doc. Ident.", "Base imponible", "Impuestos", "Total", "Fecha de pago"],
        ["2026-09-24", "P1607/2026", "CARLOTA DOIRO", "44877357X", 180, 0, 181, "2026-09-24"],
      ]),
    ).rejects.toThrow(/Fila 2: P1607\/2026 base \+ impuestos ≠ total/);
  });
});

const hasXlsxSamples = existsSync(join(PRIVATE, "optimydent-gastos-muestra.xlsx"));

describe.skipIf(!hasXlsxSamples)("Excel reales de Optimydent (muestras con pocas columnas)", () => {
  it("se leen y reconocen; avisan de las columnas imprescindibles que no se exportaron", async () => {
    await expect(parseDocument(fixture("optimydent-gastos-muestra.xlsx"), { asOf: "x" })).rejects.toThrow(
      /imprescindibles para la contabilidad: factura, impuestos, tipo de impuesto./,
    );
    await expect(parseDocument(fixture("optimydent-emitidas-muestra.xlsx"), { asOf: "x" })).rejects.toThrow(
      /imprescindibles para la contabilidad: fecha de pago/,
    );
    await expect(parseDocument(fixture("optimydent-pacientes-muestra.xlsx"), { asOf: "x" })).rejects.toThrow(
      /imprescindibles para la contabilidad: documento de identificacion/,
    );
  });
});
