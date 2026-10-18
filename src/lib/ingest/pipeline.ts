import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/format";
import { rematchPending } from "@/lib/repository/match";
import { sha256Hex } from "./dedup-hash";
import { parseDocument } from "./parsers";
import { DocumentFormatError, type NormalizedInvoice, type ParsedDocument } from "./types";

// Pipeline común a todos los canales:
//   fichero → huella SHA-256 (¿ya cargado?) → parser (rechazo entero si no cuadra)
//   → sync_run → original en Storage → función SQL atómica → estadísticas.
// La lógica antiduplicados/merge/conflictos vive en SQL (fn_ingest_*), no aquí.

export const STORAGE_BUCKET = "documentos";
const BATCH = 200;

export type IngestReport = {
  fileName: string;
  status: "ok" | "avisos" | "repetido" | "error";
  kind?: ParsedDocument["kind"];
  summary?: string;
  message?: string;
  stats?: Record<string, number>;
  warnings: string[];
  runId?: string;
};

type Db = ReturnType<typeof createAdminClient>;

const EXT: Record<string, string> = { "application/pdf": ".pdf", "text/csv": ".csv" };

export async function ingestFile(
  file: { name: string; type: string; bytes: Uint8Array },
  ctx: { actor: string; asOf: string },
): Promise<IngestReport> {
  const db = createAdminClient();
  const sha = sha256Hex(file.bytes);
  const base: IngestReport = { fileName: file.name, status: "ok", warnings: [] };

  const { data: existing, error: existingError } = await db
    .from("source_documents")
    .select("id, created_at, sync_runs(status)")
    .eq("sha256", sha)
    .maybeSingle<{ id: string; created_at: string; sync_runs: { status: string } | null }>();
  if (existingError) throw existingError;
  if (existing && existing.sync_runs?.status !== "fallido") {
    return { ...base, status: "repetido", message: `Este mismo fichero ya se cargó el ${formatDateTime(existing.created_at)}.` };
  }

  let parsed: ParsedDocument;
  try {
    parsed = await parseDocument(file.bytes, { asOf: ctx.asOf });
  } catch (e) {
    if (e instanceof DocumentFormatError) return { ...base, status: "error", message: e.message };
    throw e;
  }

  const channel = parsed.kind === "movimientos_banco" ? "banco" : "optimydent_fichero";
  const { data: runId, error: runError } = await db.rpc("fn_start_sync_run", {
    p_channel: channel,
    p_trigger: "subida_manual",
    p_actor: ctx.actor,
  });
  if (runError) return { ...base, status: "error", message: runError.message };

  const report: IngestReport = {
    ...base,
    kind: parsed.kind,
    summary: parsed.summary,
    warnings: [...parsed.warnings],
    runId: runId as string,
  };

  try {
    const docId = existing?.id ?? (await storeOriginal(db, file, sha, parsed, runId as string));
    let stats: Record<string, number>;
    if (parsed.kind === "optimydent_gastos" || parsed.kind === "optimydent_facturas_emitidas") {
      stats = await ingestInvoices(db, parsed.invoices, runId as string, docId, report);
    } else if (parsed.kind === "movimientos_banco") {
      stats = await ingestBank(db, parsed, docId);
    } else {
      stats = await ingestBalances(db, parsed, runId as string, docId);
    }
    // Facturas de la bandeja del repositorio que esperaban a que llegara su
    // registro de Optimydent: se vinculan ahora como justificante.
    if (parsed.kind === "optimydent_gastos" || parsed.kind === "optimydent_facturas_emitidas") {
      try {
        const linked = await rematchPending(db);
        if (linked) stats.justificantes_vinculados = linked;
      } catch (e) {
        report.warnings.push(`No se pudo revisar la bandeja del repositorio: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.stats = stats;
    const withIssues = (stats.error ?? 0) + (stats.conflicto ?? 0) + (stats.periodo_cerrado ?? 0) > 0;
    report.status = withIssues || report.warnings.length > 0 ? "avisos" : "ok";
    await db
      .from("sync_runs")
      .update({
        status: withIssues ? "completado_con_avisos" : "completado",
        finished_at: new Date().toISOString(),
        period_from: parsed.coversFrom,
        period_to: parsed.coversTo,
        stats: { ...stats, fichero: file.name, avisos: report.warnings.slice(0, 50) },
      })
      .eq("id", runId as string);
    return report;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("sync_runs")
      .update({ status: "fallido", finished_at: new Date().toISOString(), error: message })
      .eq("id", runId as string);
    return { ...report, status: "error", message };
  }
}

async function storeOriginal(
  db: Db,
  file: { name: string; type: string; bytes: Uint8Array },
  sha: string,
  parsed: ParsedDocument,
  runId: string,
): Promise<string> {
  const mime = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/pdf");
  const year = (parsed.coversTo ?? new Date().toISOString()).slice(0, 4);
  const path = `${parsed.kind}/${year}/${sha}${EXT[mime] ?? ""}`;
  const { error: upError } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(path, file.bytes, { contentType: mime, upsert: true });
  if (upError) throw new Error(`No se pudo guardar el original: ${upError.message}`);

  const { data, error } = await db
    .from("source_documents")
    .insert({
      sync_run_id: runId,
      kind: parsed.kind,
      file_name: file.name,
      mime_type: mime,
      storage_path: path,
      sha256: sha,
      byte_size: file.bytes.byteLength,
      covers_from: parsed.coversFrom,
      covers_to: parsed.coversTo,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

type InvoiceResult = { result: string; message?: string; index: number };

async function ingestInvoices(
  db: Db,
  invoices: NormalizedInvoice[],
  runId: string,
  docId: string,
  report: IngestReport,
): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (let i = 0; i < invoices.length; i += BATCH) {
    const chunk = invoices.slice(i, i + BATCH);
    const { data, error } = await db.rpc("fn_ingest_invoices", { p_items: chunk, p_run: runId, p_doc: docId });
    if (error) throw new Error(error.message);
    for (const r of data as InvoiceResult[]) {
      stats[r.result] = (stats[r.result] ?? 0) + 1;
      if (r.result === "error") {
        const inv = chunk[r.index];
        report.warnings.push(`${inv.issuer_name} · ${inv.invoice_number}: ${r.message}`);
      }
    }
  }
  stats.revision = invoices.filter((i) => i.review_reasons.length > 0).length;
  return stats;
}

async function ingestBank(
  db: Db,
  parsed: Extract<ParsedDocument, { kind: "movimientos_banco" }>,
  docId: string,
): Promise<Record<string, number>> {
  const { data: account, error } = await db
    .from("bank_accounts")
    .select("id, name, account_number")
    .eq("bank", parsed.bank)
    .single<{ id: string; name: string; account_number: string | null }>();
  if (error) throw new Error(`No hay cuenta configurada para ${parsed.bank}`);

  if (parsed.accountNumber) {
    if (!account.account_number) {
      await db.from("bank_accounts").update({ account_number: parsed.accountNumber }).eq("id", account.id);
    } else if (account.account_number !== parsed.accountNumber) {
      throw new DocumentFormatError(
        `El fichero es de la cuenta …${parsed.accountNumber.slice(-4)}, pero ${account.name} está registrada con la …${account.account_number.slice(-4)}.`,
      );
    }
  }
  const { data, error: rpcError } = await db.rpc("fn_ingest_bank_transactions", {
    p_account: account.id,
    p_items: parsed.transactions,
    p_doc: docId,
  });
  if (rpcError) throw new Error(rpcError.message);
  return data as Record<string, number>;
}

async function ingestBalances(
  db: Db,
  parsed: Extract<ParsedDocument, { kind: "optimydent_saldos_acreedores" | "optimydent_saldos_deudores" }>,
  runId: string,
  docId: string,
): Promise<Record<string, number>> {
  const { data, error } = await db.rpc("fn_ingest_balance_snapshot", {
    p: { as_of: parsed.asOf, side: parsed.side, lines: parsed.lines },
    p_run: runId,
    p_doc: docId,
  });
  if (error) throw new Error(error.message);
  const r = data as { result: string; patients: number };
  return { [r.result]: 1, pacientes: r.patients };
}
