import "server-only";
import { createHash } from "node:crypto";
import { COMPANY } from "@/lib/company";
import { STORAGE_BUCKET } from "@/lib/ingest/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildGestorModel, type ExportData, type GestorModel } from "./model";
import { verifyGestorXlsx, type Verification } from "./verify";
import { writeGestorXlsx } from "./xlsx";

// Generación del Excel del gestor: datos de la BBDD → controles → .xlsx →
// relectura celda a celda → versión nueva (v1, v2…) guardada en Storage y en
// erp.gestor_exports. Nunca se pisa una versión ya generada.

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type GestorVersion = {
  id: string;
  version: number;
  file_name: string;
  generated_at: string;
  generated_by: string;
  fingerprint: string | null;
};

export async function loadGestorModel(year: number, quarter: number): Promise<GestorModel> {
  const { data, error } = await createAdminClient().rpc("fn_gestor_export_data", { p_year: year, p_quarter: quarter });
  if (error) throw new Error(error.message);
  return buildGestorModel(data as ExportData);
}

export async function listGestorVersions(year: number, quarter: number): Promise<GestorVersion[]> {
  const { data, error } = await createAdminClient()
    .from("gestor_exports")
    .select("id, version, file_name, generated_at, generated_by, verification")
    .eq("kind", "trimestral")
    .eq("year", year)
    .eq("quarter", quarter)
    .order("version", { ascending: false })
    .returns<(Omit<GestorVersion, "fingerprint"> & { verification: { fingerprint?: string } })[]>();
  if (error) throw new Error(error.message);
  return data.map(({ verification, ...v }) => ({ ...v, fingerprint: verification?.fingerprint ?? null }));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** «CCF Contabilidad 3ºTrim2026 06 10 2026 v2.xlsx», como los ficheros que ya se entregaban. */
export function gestorFileName(year: number, quarter: number, version: number, today: Date): string {
  const d = `${pad(today.getDate())} ${pad(today.getMonth() + 1)} ${today.getFullYear()}`;
  return `CCF Contabilidad ${quarter}ºTrim${year} ${d}${version > 1 ? ` v${version}` : ""}.xlsx`;
}

export type GenerateResult =
  | { ok: true; id: string; version: number; fileName: string; verification: Verification }
  | { ok: false; message: string; verification?: Verification };

export async function generateGestorExcel(year: number, quarter: number, actor: string): Promise<GenerateResult> {
  const model = await loadGestorModel(year, quarter);
  const blocking = model.checks.filter((c) => c.level === "error");
  if (blocking.length) {
    return { ok: false, message: `No se puede generar: ${blocking.map((c) => c.items[0] ?? c.title).join(" · ")}` };
  }

  const bytes = await writeGestorXlsx(model, { companyName: COMPANY.legalName });
  const verification = verifyGestorXlsx(bytes, model);
  if (!verification.ok) {
    return { ok: false, message: "El Excel generado no cuadra con los datos: no se ha guardado.", verification };
  }

  const db = createAdminClient();
  const previous = await listGestorVersions(year, quarter);
  const version = (previous[0]?.version ?? 0) + 1;
  const fileName = gestorFileName(year, quarter, version, new Date());
  const path = `gestor/${year}/${quarter}T/v${version}-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.xlsx`;
  const { error: upError } = await db.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: XLSX_MIME, upsert: false });
  if (upError) return { ok: false, message: `No se pudo guardar el Excel: ${upError.message}` };

  const { data, error } = await db
    .from("gestor_exports")
    .insert({
      kind: "trimestral",
      year,
      quarter,
      version,
      file_name: fileName,
      storage_path: path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      verification: {
        ok: verification.ok,
        checks: verification.checks,
        fingerprint: model.fingerprint,
        kpis: model.kpis,
        avisos: model.checks.filter((c) => c.level === "aviso").map((c) => c.title),
      },
      generated_by: actor,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    // Otra generación simultánea ocupó el mismo nº de versión: no se pisa nada.
    await db.storage.from(STORAGE_BUCKET).remove([path]);
    return { ok: false, message: `No se pudo registrar la versión: ${error.message}` };
  }
  return { ok: true, id: data.id, version, fileName, verification };
}
