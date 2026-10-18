import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { invoiceDedupHash } from "@/lib/ingest/dedup-hash";
import { normName, normTaxId } from "@/lib/ingest/normalize";
import { parseDocument } from "@/lib/ingest/parsers";
import type { NormalizedInvoice } from "@/lib/ingest/types";
import { createTestDb } from "./helpers/db";

const PRIVATE = join(__dirname, "fixtures", "private");
const hasPrivate = existsSync(join(PRIVATE, "optimydent-gastos-3T2026.pdf"));

describe("paridad TS ↔ SQL", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it.each([
    ["52683874 m", "x"],
    ["B-67717082", "x"],
    [null, "  Vistaprint   B.V "],
    ["", "Ñandú S.L."],
  ])("normalización y huella iguales para %s / %s", async (taxId, name) => {
    const r = await db.query<{ t: string | null; n: string; h: string }>(
      "select erp.norm_tax_id($1) as t, erp.norm_name($2) as n, erp.invoice_dedup_hash(erp.issuer_key_of($1, $2), ' a-12 /2026 ', '2026-09-30', 1234.5) as h",
      [taxId, name],
    );
    expect(r.rows[0].t).toBe(normTaxId(taxId));
    expect(r.rows[0].n).toBe(normName(name));
    expect(r.rows[0].h).toBe(
      invoiceDedupHash({ issuerTaxId: taxId, issuerName: name, invoiceNumber: " a-12 /2026 ", issueDate: "2026-09-30", totalCents: 123450 }),
    );
  });
});

describe.skipIf(!hasPrivate)("ingesta real 3T2026 en BBDD", () => {
  let db: PGlite;
  let run: string;
  const load = async (items: NormalizedInvoice[]) => {
    const res: { result: string; message?: string }[] = [];
    for (let i = 0; i < items.length; i += 200) {
      const r = await db.query<{ r: typeof res }>("select erp.fn_ingest_invoices($1::jsonb, $2, null) as r", [
        JSON.stringify(items.slice(i, i + 200)),
        run,
      ]);
      res.push(...r.rows[0].r);
    }
    const tally: Record<string, number> = {};
    for (const x of res) tally[x.result] = (tally[x.result] ?? 0) + 1;
    return { tally, errors: res.filter((x) => x.result === "error") };
  };

  beforeAll(async () => {
    db = await createTestDb();
    run = (await db.query<{ id: string }>("select erp.fn_start_sync_run('optimydent_fichero', 'subida_manual', 'test') as id")).rows[0].id;
  });

  it("emitidas: 462 altas; recargar el mismo fichero → 462 sin cambios", async () => {
    const doc = await parseDocument(new Uint8Array(readFileSync(join(PRIVATE, "optimydent-emitidas-3T2026.pdf"))), { asOf: "2026-10-06" });
    if (doc.kind !== "optimydent_facturas_emitidas") throw new Error(doc.kind);
    const first = await load(doc.invoices);
    expect(first.errors).toEqual([]);
    expect(first.tally).toEqual({ insertada: 462 });
    expect((await load(doc.invoices)).tally).toEqual({ sin_cambios: 462 });
    const { rows } = await db.query<{ n: number; total: string }>(
      "select count(*)::int as n, sum(total) as total from erp.invoices where direction = 'emitida'",
    );
    expect(rows[0].n).toBe(462);
  });

  it("gastos: altas + el nº repetido en dos meses (OPTO2026/1013) sale como conflicto", async () => {
    const doc = await parseDocument(new Uint8Array(readFileSync(join(PRIVATE, "optimydent-gastos-3T2026.pdf"))), { asOf: "2026-10-06" });
    if (doc.kind !== "optimydent_gastos") throw new Error(doc.kind);
    const { tally, errors } = await load(doc.invoices);
    expect(errors).toEqual([]);
    expect(tally.conflicto).toBeGreaterThanOrEqual(1);
    expect(tally.insertada + tally.conflicto).toBe(doc.invoices.length);
    const c = await db.query<{ number: string; differences: Record<string, unknown> }>(
      `select i.invoice_number as number, c.differences from erp.ingest_conflicts c
         join erp.invoices i on i.id = c.existing_invoice_id`,
    );
    expect(c.rows.map((r) => r.number)).toContain("OPTO2026/1013");
    // Todo lo conocido queda clasificado por regla; nada sin partida salvo tipos nuevos.
    const sinPartida = await db.query<{ n: number }>(
      "select count(*)::int as n from erp.invoices where direction = 'recibida' and category_id is null",
    );
    expect(sinPartida.rows[0].n).toBe(0);
  });
});
