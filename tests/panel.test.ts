import { describe, expect, it } from "vitest";
import { compute303 } from "@/lib/fiscal";
import { detectRecurringAlerts, lastCompleteMonth, recurringWindowStart, type RecurringInvoice } from "@/lib/recurring";

const monthly = (key: string, months: string[], total = 100): RecurringInvoice[] =>
  months.map((m) => ({ key, name: key, issueDate: `${m}-05`, total }));

describe("avisos de recurrentes", () => {
  it("solo juzga meses completos según lo cargado", () => {
    expect(lastCompleteMonth("2026-09-30")).toBe("2026-09");
    expect(lastCompleteMonth("2026-09-29")).toBe("2026-08");
    expect(lastCompleteMonth(null)).toBeNull();
    expect(recurringWindowStart("2026-09-30")).toBe("2026-04-01");
  });

  it("avisa una vez del proveedor mensual que deja de facturar", () => {
    const inv = monthly("SEGURO", ["2026-04", "2026-05", "2026-06", "2026-07"], 85.2);
    const alerts = detectRecurringAlerts(inv, "2026-09-30");
    expect(alerts).toEqual([{ kind: "falta", key: "SEGURO", name: "SEGURO", month: "2026-08", expected: 85.2 }]);
  });

  it("no avisa de lo esporádico ni de meses aún no cargados", () => {
    const inv = [
      ...monthly("ESPORADICO", ["2026-04", "2026-07"]),
      ...monthly("MENSUAL", ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]),
    ];
    expect(detectRecurringAlerts(inv, "2026-09-30")).toEqual([]);
    // Octubre a medio cargar: no se juzga.
    expect(detectRecurringAlerts(inv, "2026-10-15")).toEqual([]);
  });

  it("avisa de un importe muy distinto del habitual", () => {
    const inv = [...monthly("LUZ", ["2026-05", "2026-06", "2026-07", "2026-08"], 200), ...monthly("LUZ", ["2026-09"], 420)];
    expect(detectRecurringAlerts(inv, "2026-09-30")).toEqual([
      { kind: "importe", key: "LUZ", name: "LUZ", month: "2026-09", expected: 200, actual: 420 },
    ]);
  });
});

describe("Modelo 303", () => {
  it("devengado, exentas, soportado y prorrata", () => {
    const m = compute303(
      [
        { direction: "emitida", vat_rate: 0, exempt: true, base: 50000, vat: 0 },
        { direction: "emitida", vat_rate: 0.21, exempt: false, base: 1000, vat: 210 },
        { direction: "recibida", vat_rate: 0.21, exempt: false, base: 2000, vat: 420 },
        { direction: "recibida", vat_rate: 0.1, exempt: false, base: 100, vat: 10 },
        { direction: "recibida", vat_rate: 0, exempt: true, base: 300, vat: 0 },
      ],
      10,
    );
    expect(m).toMatchObject({
      exentas: 50000,
      totalDevengado: 210,
      totalSoportado: 430,
      soportadoExento: 300,
      deducible: 43,
      resultado: 167,
    });
    expect(m.soportado.map((b) => b.rate)).toEqual([0.21, 0.1]);
  });
});

describe("cashflow semanal", () => {
  it("parte del saldo, mete lo vencido en la 1.ª semana y acumula", async () => {
    const { weeklyCashflow, cashflowHorizon } = await import("@/lib/cashflow");
    const weeks = weeklyCashflow(
      [
        { expected_date: "2026-10-01", amount: 100 }, // vencido
        { expected_date: "2026-10-22", amount: -40.5 },
        { expected_date: "2026-10-27", amount: 200 },
        { expected_date: "2027-03-01", amount: 999 }, // fuera del horizonte
      ],
      "2026-10-20",
      1000,
      2,
    );
    expect(weeks.map((w) => [w.inflow, w.outflow, w.balance])).toEqual([
      [100, 40.5, 1059.5],
      [200, 0, 1259.5],
    ]);
    expect(cashflowHorizon("2026-10-20", 2)).toBe("2026-11-02");
  });
});
