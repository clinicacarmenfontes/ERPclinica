import "server-only";
import type { NormalizedInvoice } from "@/lib/ingest/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RepositoryRole } from "./paths";

type Db = ReturnType<typeof createAdminClient>;
export type Candidate = { id: string; invoice_number: string; issuer_name: string; issue_date: string; total: number; score: number };

// Vincular solo si es inequívoco: puntuación alta y sin una segunda candidata cercana.
const AUTO_LINK = 0.8;
const MARGIN = 0.2;

export async function findCandidates(db: Db, draft: NormalizedInvoice): Promise<Candidate[]> {
  const { data, error } = await db.rpc("fn_match_extraction", {
    p: {
      direction: draft.direction,
      issuer_tax_id: draft.issuer_tax_id,
      issuer_name: draft.issuer_name,
      invoice_number: draft.invoice_number,
      issue_date: draft.issue_date,
      total: draft.total,
    },
  });
  if (error) throw error;
  return (data as Candidate[]) ?? [];
}

export function autoLinkTarget(candidates: Candidate[]): Candidate | null {
  const [top, second] = candidates;
  if (!top || top.score < AUTO_LINK) return null;
  if (second && second.score > top.score - MARGIN) return null;
  return top;
}

/** Motivo de revisión cuando no hay pareja, según la carpeta. */
export function unmatchedReason(role: RepositoryRole): string | null {
  if (role === "registrada_optimydent") return "picada_sin_registro";
  if (role === "pendiente_registrar") return "no_registrada_optimydent";
  return null;
}

/**
 * Vuelve a buscar pareja para las lecturas pendientes (p. ej. después de subir
 * el listado de gastos de Optimydent, o cuando se ha movido el PDF a PICADAS).
 */
export async function rematchPending(db: Db = createAdminClient()): Promise<number> {
  const { data, error } = await db
    .from("document_extractions")
    .select("id, extracted, folder_role")
    .eq("status", "pendiente")
    .in("folder_role", ["registrada_optimydent", "pendiente_registrar"])
    .returns<{ id: string; extracted: { draft?: NormalizedInvoice | null }; folder_role: RepositoryRole }[]>();
  if (error) throw error;
  let linked = 0;
  for (const e of data) {
    const draft = e.extracted.draft;
    if (!draft) continue;
    const candidates = await findCandidates(db, draft);
    const target = autoLinkTarget(candidates);
    if (target) {
      const { error: linkError } = await db.rpc("fn_link_extraction", {
        p_extraction: e.id,
        p_invoice: target.id,
        p_actor: "sistema",
      });
      if (!linkError) linked++;
    } else {
      await db.from("document_extractions").update({ match_candidates: candidates }).eq("id", e.id);
    }
  }
  return linked;
}
