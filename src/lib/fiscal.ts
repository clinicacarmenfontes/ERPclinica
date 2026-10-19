// Borrador del Modelo 303 a partir de v_vat_by_quarter. Orientativo: el
// gestor lo valida (prorrata, operaciones no sujetas, regularizaciones…).

export type VatRow = { direction: "emitida" | "recibida"; vat_rate: number; exempt: boolean; base: number; vat: number };

export type VatBucket = { rate: number; base: number; vat: number };

export type Model303 = {
  devengado: VatBucket[];
  exentas: number;
  totalDevengado: number;
  soportado: VatBucket[];
  soportadoExento: number;
  totalSoportado: number;
  prorrataPct: number;
  deducible: number;
  resultado: number;
};

const cents = (n: number) => Math.round(Number(n) * 100);

function buckets(rows: VatRow[]): { taxed: VatBucket[]; exempt: number } {
  const byRate = new Map<number, { base: number; vat: number }>();
  let exempt = 0;
  for (const r of rows) {
    const rate = Number(r.vat_rate);
    if (r.exempt || rate === 0) {
      exempt += cents(r.base);
      continue;
    }
    const b = byRate.get(rate) ?? { base: 0, vat: 0 };
    b.base += cents(r.base);
    b.vat += cents(r.vat);
    byRate.set(rate, b);
  }
  return {
    taxed: [...byRate.entries()]
      .sort(([a], [b]) => b - a)
      .map(([rate, b]) => ({ rate, base: b.base / 100, vat: b.vat / 100 })),
    exempt: exempt / 100,
  };
}

export function compute303(rows: VatRow[], prorrataPct: number): Model303 {
  const out = buckets(rows.filter((r) => r.direction === "emitida"));
  const inc = buckets(rows.filter((r) => r.direction === "recibida"));
  const totalDevengado = out.taxed.reduce((s, b) => s + cents(b.vat), 0);
  const totalSoportado = inc.taxed.reduce((s, b) => s + cents(b.vat), 0);
  const deducible = Math.round((totalSoportado * prorrataPct) / 100);
  return {
    devengado: out.taxed,
    exentas: out.exempt,
    totalDevengado: totalDevengado / 100,
    soportado: inc.taxed,
    soportadoExento: inc.exempt,
    totalSoportado: totalSoportado / 100,
    prorrataPct,
    deducible: deducible / 100,
    resultado: (totalDevengado - deducible) / 100,
  };
}
