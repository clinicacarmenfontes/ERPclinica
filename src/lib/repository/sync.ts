import "server-only";
import { createHash } from "node:crypto";
import { extractInvoice, EXTRACTION_MODEL } from "@/lib/ai/extract-invoice";
import { STORAGE_BUCKET } from "@/lib/ingest/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDraft } from "./draft";
import { downloadItem, downloadPreviewJpeg, getGraphAccessToken, listTree, resolveSharedFolder, type DriveFile } from "./graph";
import { autoLinkTarget, findCandidates, unmatchedReason } from "./match";
import { classifyPath, type RepositoryRole } from "./paths";

// Repositorio de facturas (OneDrive de info@). El flujo principal del ERP son
// los listados de Optimydent; el repositorio es un apoyo BAJO DEMANDA:
//   · refreshInventory(): lista la carpeta y clasifica cada fichero por su
//     carpeta. Gratis: no lee nada con Claude.
//   · readItems(ids): lee con Claude SOLO los ficheros que elijas, los empareja
//     con lo registrado (vincula el justificante si es inequívoco) y el resto
//     pasa a la bandeja de revisión.

type Db = ReturnType<typeof createAdminClient>;
const FROM_YEAR = Number(process.env.REPOSITORY_FROM_YEAR || 2026);
const CONCURRENCY = 4;
const MAX_IMAGE_BYTES = 3_700_000; // 5 MB en base64

export type InventoryResult = { listed: number; unread: number };

export type ReadResult = {
  processed: number;
  remaining: string[];
  linked: number;
  pending: number;
  discarded: number;
  errors: string[];
};

type Item = {
  drive_item_id: string;
  drive_id: string;
  path: string;
  name: string;
  role: RepositoryRole;
  year: number | null;
  attempts: number;
};

export async function refreshInventory(): Promise<InventoryResult> {
  const db = createAdminClient();
  const token = await getGraphAccessToken();
  const folder = await resolveSharedFolder(token);
  const files = await listTree(token, folder.driveId, folder.itemId, (path) => {
    const top = path.split("/")[0];
    const m = /(20\d{2})$/.exec(top);
    return path.split("/").length === 1 && (!m || Number(m[1]) < FROM_YEAR);
  });
  await upsertInventory(db, files);
  const { count } = await db
    .from("repository_items")
    .select("drive_item_id", { count: "exact", head: true })
    .eq("status", "nuevo")
    .neq("role", "ignorado");
  return { listed: files.length, unread: count ?? 0 };
}

/** Lee con Claude los ficheros indicados, dentro de un presupuesto de tiempo. */
export async function readItems(ids: string[], opts: { budgetMs: number }): Promise<ReadResult> {
  const started = Date.now();
  const db = createAdminClient();
  const token = await getGraphAccessToken();
  const { data: queue, error } = await db
    .from("repository_items")
    .select("drive_item_id, drive_id, path, name, role, year, attempts")
    .in("drive_item_id", ids)
    .neq("role", "ignorado")
    .returns<Item[]>();
  if (error) throw error;

  const result: ReadResult = { processed: 0, remaining: [], linked: 0, pending: 0, discarded: 0, errors: [] };
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && Date.now() - started < opts.budgetMs) {
      const item = queue[cursor++];
      try {
        const outcome = await processItem(db, token, item);
        result.processed++;
        result[outcome]++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        result.errors.push(`${item.path}: ${message}`);
        await db
          .from("repository_items")
          .update({ status: "error", error: message.slice(0, 500), attempts: item.attempts + 1 })
          .eq("drive_item_id", item.drive_item_id);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  result.remaining = queue.slice(cursor).map((i) => i.drive_item_id);
  return result;
}

/** Alta/actualización del inventario. Si cambia el contenido (cTag), vuelve a "sin leer". */
async function upsertInventory(db: Db, files: DriveFile[]) {
  const { data: existing, error } = await db
    .from("repository_items")
    .select("drive_item_id, ctag, status, attempts, error")
    .returns<{ drive_item_id: string; ctag: string | null; status: string; attempts: number; error: string | null }[]>();
  if (error) throw error;
  const known = new Map(existing.map((r) => [r.drive_item_id, r]));
  const now = new Date().toISOString();

  const rows = files.map((f) => {
    const info = classifyPath(f.path, FROM_YEAR);
    const prev = known.get(f.id);
    const contentChanged = prev && prev.ctag !== f.cTag;
    const status =
      info.role === "ignorado" ? "ignorado" : !prev || contentChanged ? "nuevo" : prev.status === "ignorado" ? "nuevo" : prev.status;
    return {
      drive_item_id: f.id,
      drive_id: f.driveId,
      path: f.path,
      name: f.name,
      etag: f.eTag,
      ctag: f.cTag,
      size: f.size,
      last_modified: f.lastModified,
      year: info.year,
      quarter: info.quarter,
      role: info.role,
      status,
      attempts: !prev || contentChanged ? 0 : prev.attempts,
      error: info.role === "ignorado" ? (info.reason ?? null) : status === "error" ? (prev?.error ?? null) : null,
      seen_at: now,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error: upError } = await db.from("repository_items").upsert(rows.slice(i, i + 500));
    if (upError) throw upError;
  }
}

const KIND_BY_ROLE: Record<RepositoryRole, string> = {
  profesional: "factura_profesional",
  emitida: "factura_emitida",
  registrada_optimydent: "factura_recibida",
  pendiente_registrar: "factura_recibida",
  ignorado: "factura_recibida",
};

async function processItem(db: Db, token: string, item: Item): Promise<"linked" | "pending" | "discarded"> {
  const ext = item.name.split(".").pop()!.toLowerCase();
  let bytes = await downloadItem(token, item.drive_id, item.drive_item_id);
  let mediaType: "application/pdf" | "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  if (ext === "pdf") mediaType = "application/pdf";
  else if (ext === "png" || ext === "gif" || ext === "webp") mediaType = `image/${ext}`;
  else mediaType = "image/jpeg";

  const sha = createHash("sha256").update(bytes).digest("hex");

  // El mismo fichero en dos carpetas (p. ej. IMG_9928 en PICADAS y en "metidas…"): una sola lectura.
  const { data: dup } = await db
    .from("source_documents")
    .select("id, document_extractions(status)")
    .eq("sha256", sha)
    .maybeSingle<{ id: string; document_extractions: { status: string } | null }>();
  if (dup?.document_extractions) {
    await db
      .from("repository_items")
      .update({ status: "procesado", source_document_id: dup.id, error: null })
      .eq("drive_item_id", item.drive_item_id);
    return dup.document_extractions.status === "vinculado" ? "linked" : dup.document_extractions.status === "descartado" ? "discarded" : "pending";
  }

  const original = bytes;
  if (mediaType !== "application/pdf" && (bytes.byteLength > MAX_IMAGE_BYTES || ext === "heic" || ext === "heif")) {
    bytes = await downloadPreviewJpeg(token, item.drive_id, item.drive_item_id);
    mediaType = "image/jpeg";
  }

  let extraction;
  try {
    extraction = await extractInvoice({ bytes, mediaType }, { role: item.role, fileName: item.name });
    await db.from("ai_runs").insert({
      purpose: "extraccion",
      model: extraction.model,
      input_hash: sha,
      input_tokens: extraction.inputTokens,
      output_tokens: extraction.outputTokens,
      output: extraction.data,
    });
  } catch (e) {
    await db.from("ai_runs").insert({ purpose: "extraccion", model: EXTRACTION_MODEL, input_hash: sha, error: String(e).slice(0, 1000) });
    throw e;
  }

  const draft = buildDraft(extraction.data, item.role);

  // Original en Storage + documento inmutable (se guarda el original, no la versión reducida).
  const storagePath = `repositorio/${item.year ?? "sin-año"}/${sha}.${ext}`;
  const { error: upError } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, original, {
    contentType: ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" || ext === "jfif" ? "jpeg" : ext}`,
    upsert: true,
  });
  if (upError) throw new Error(`No se pudo guardar el original: ${upError.message}`);
  const { data: doc, error: docError } = await db
    .from("source_documents")
    .insert({
      kind: KIND_BY_ROLE[item.role],
      file_name: item.name,
      mime_type: ext === "pdf" ? "application/pdf" : `image/${ext}`,
      storage_path: storagePath,
      sha256: sha,
      byte_size: original.byteLength,
      covers_from: draft.invoice?.issue_date ?? null,
      covers_to: draft.invoice?.issue_date ?? null,
    })
    .select("id")
    .single();
  if (docError) throw docError;

  const candidates = draft.invoice ? await findCandidates(db, draft.invoice) : [];
  const reasons = [...draft.reasons];
  const target = autoLinkTarget(candidates);
  if (!target && !draft.notAnInvoice) {
    const r = unmatchedReason(item.role);
    if (r) reasons.push(r);
  }

  const { data: ex, error: exError } = await db
    .from("document_extractions")
    .insert({
      source_document_id: doc.id,
      extracted: { ...extraction.data, draft: draft.invoice },
      confidence: Math.max(0, Math.min(1, Math.round(extraction.data.confidence * 100) / 100)),
      model: extraction.model,
      folder_role: item.role,
      repository_path: item.path,
      match_candidates: candidates,
      review_reasons: [...new Set(reasons)],
    })
    .select("id")
    .single();
  if (exError) throw exError;

  let outcome: "linked" | "pending" | "discarded" = "pending";
  if (draft.notAnInvoice) {
    await db.rpc("fn_discard_extraction", {
      p_extraction: ex.id,
      p_reason: `No es una factura (${extraction.data.document_type.replace(/_/g, " ")}): descartado automáticamente`,
      p_actor: "sistema",
    });
    outcome = "discarded";
  } else if (target) {
    const { error: linkError } = await db.rpc("fn_link_extraction", { p_extraction: ex.id, p_invoice: target.id, p_actor: "sistema" });
    if (linkError) throw linkError;
    outcome = "linked";
  }

  await db
    .from("repository_items")
    .update({ status: "procesado", source_document_id: doc.id, error: null, attempts: item.attempts + 1 })
    .eq("drive_item_id", item.drive_item_id);
  return outcome;
}
