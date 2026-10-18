import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// El ERP comparte proyecto Supabase con el CRM (plan gratuito: máx. 2 proyectos).
// Este test carga las migraciones REALES de ambos en la misma BBDD y comprueba
// que no chocan y que los usuarios del CRM no ven nada del ERP.
const CRM_MIGRATIONS = join(__dirname, "..", "..", "..", "10. CRM", "crm-carmen-fontes", "supabase", "migrations");
const ERP_MIGRATIONS = join(__dirname, "..", "supabase", "migrations");
const hasCrm = existsSync(CRM_MIGRATIONS);

const STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon;
  create role authenticated;
  create role service_role bypassrls; -- como en Supabase: la clave secreta se salta RLS
`;

const load = async (db: PGlite, dir: string) => {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
};

describe.skipIf(!hasCrm)("ERP y CRM en el mismo proyecto Supabase", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(STUBS);
    await load(db, CRM_MIGRATIONS);
    await load(db, ERP_MIGRATIONS);
  });

  it("el ERP no crea ni modifica nada en public (esquema del CRM)", async () => {
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('invoices', 'parties', 'accounts', 'journal_entries', 'audit_log')`,
    );
    expect(r.rows[0].n).toBe(0);
    const tables = await db.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'erp'",
    );
    expect(tables.rows[0].n).toBeGreaterThan(25);
  });

  it("los usuarios del CRM (authenticated / anon) no ven el esquema erp", async () => {
    for (const role of ["authenticated", "anon"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query("select count(*) from erp.invoices");
        }),
      ).rejects.toThrow(/permission denied/);
      await expect(
        db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`);
          await tx.query("select erp.fn_ingest_invoices('[]'::jsonb, null, null)");
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("el CRM sigue funcionando: sus permisos sobre public están intactos", async () => {
    const r = await db.query<{ ok: boolean }>(
      `select has_function_privilege('authenticated', 'public.mark_lead_request_called(uuid)', 'execute') as ok`,
    );
    expect(r.rows[0].ok).toBe(true);
    // set_updated_at del CRM sigue siendo el suyo (el ERP usa erp.set_updated_at).
    const f = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'set_updated_at'",
    );
    expect(f.rows[0].n).toBe(2);
  });

  it("el servidor del ERP (service_role) trabaja con normalidad", async () => {
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      const r = await tx.query<{ n: number }>("select count(*)::int as n from erp.expense_types");
      expect(r.rows[0].n).toBe(65);
    });
  });
});
