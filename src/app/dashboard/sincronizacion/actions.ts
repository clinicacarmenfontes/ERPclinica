"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { ingestFile, type IngestReport } from "@/lib/ingest/pipeline";
import { todayMadrid } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel limita el cuerpo de cada petición a 4,5 MB: el cliente sube los
// ficheros de uno en uno y aquí se rechaza lo que no quepa.
const MAX_BYTES = 4 * 1024 * 1024;

export async function uploadDocument(formData: FormData): Promise<IngestReport> {
  const { email } = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) return { fileName: "?", status: "error", message: "No se ha recibido ningún fichero.", warnings: [] };
  if (file.size > MAX_BYTES) {
    return { fileName: file.name, status: "error", message: "El fichero supera 4 MB.", warnings: [] };
  }
  const asOfRaw = String(formData.get("asOf") ?? "");
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) ? asOfRaw : todayMadrid();

  const report = await ingestFile(
    { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
    { actor: email, asOf },
  );
  revalidatePath("/dashboard", "layout");
  return report;
}

export async function resolveConflict(
  conflictId: string,
  resolution: "mantener_existente" | "sustituir_por_entrante",
  note: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { email } = await requireAdmin();
  if (resolution === "sustituir_por_entrante" && note.trim().length < 10) {
    return { ok: false, message: "Para sustituir la factura indica el motivo (mín. 10 caracteres)." };
  }
  const { error } = await createAdminClient().rpc("fn_resolve_conflict", {
    p_conflict_id: conflictId,
    p_resolution: resolution,
    p_note: note,
    p_actor: email,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
