"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import type { NormalizedInvoice } from "@/lib/ingest/types";
import { GraphAuthError } from "@/lib/repository/graph";
import { readItems, refreshInventory, type InventoryResult, type ReadResult } from "@/lib/repository/sync";
import { createAdminClient } from "@/lib/supabase/admin";

type Result<T = unknown> = { ok: true; data: T } | { ok: false; message: string };

const errorMessage = (e: unknown) => (e instanceof GraphAuthError || e instanceof Error ? e.message : String(e));

/** Lista la carpeta de OneDrive (sin leer nada con Claude). */
export async function refreshInventoryAction(): Promise<Result<InventoryResult>> {
  await requireAdmin();
  try {
    const data = await refreshInventory();
    revalidatePath("/dashboard/repositorio");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** Lee con Claude SOLO los ficheros elegidos. La pantalla manda tandas pequeñas. */
export async function readItemsAction(ids: string[]): Promise<Result<ReadResult>> {
  await requireAdmin();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50) {
    return { ok: false, message: "Elige entre 1 y 50 ficheros por tanda." };
  }
  try {
    const data = await readItems(ids, { budgetMs: 220_000 });
    revalidatePath("/dashboard", "layout");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function linkExtractionAction(extractionId: string, invoiceId: string): Promise<Result> {
  const { email } = await requireAdmin();
  const { error } = await createAdminClient().rpc("fn_link_extraction", {
    p_extraction: extractionId,
    p_invoice: invoiceId,
    p_actor: email,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: null };
}

export async function discardExtractionAction(extractionId: string, reason: string): Promise<Result> {
  const { email } = await requireAdmin();
  const { error } = await createAdminClient().rpc("fn_discard_extraction", {
    p_extraction: extractionId,
    p_reason: reason,
    p_actor: email,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true, data: null };
}

export type BookForm = {
  direction: "emitida" | "recibida";
  issuer_name: string;
  issuer_tax_id: string;
  counterparty_name: string;
  counterparty_tax_id: string;
  invoice_number: string;
  issue_date: string;
  base: number;
  vat: number;
  withholding: number;
  expense_type: string;
};

const cents = (n: number) => Math.round(n * 100);
const STANDARD_VAT = [0, 0.04, 0.1, 0.21];

/** Contabilizar desde la bandeja con los datos (corregidos) del formulario. */
export async function bookExtractionAction(extractionId: string, form: BookForm): Promise<Result<{ result: string }>> {
  const { email } = await requireAdmin();
  const db = createAdminClient();
  const { data: ex, error } = await db
    .from("document_extractions")
    .select("extracted, folder_role")
    .eq("id", extractionId)
    .single<{ extracted: { draft?: NormalizedInvoice | null }; folder_role: string }>();
  if (error) return { ok: false, message: error.message };

  if (!form.issuer_name.trim() || !form.invoice_number.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.issue_date)) {
    return { ok: false, message: "Faltan emisor, número o fecha." };
  }
  const draft = ex.extracted.draft;
  const base = cents(form.base);
  const vat = cents(form.vat);
  const wh = cents(form.withholding);
  // Si los importes son los leídos, se conservan sus líneas (varios tipos de IVA);
  // si los has cambiado, una sola línea con lo que has escrito.
  const sameAmounts =
    draft && cents(draft.base_total) === base && cents(draft.vat_total) === vat && cents(draft.withholding_total) === wh;
  const rate = base ? vat / base : 0;
  const lines = sameAmounts
    ? draft!.lines
    : [
        {
          base: base / 100,
          vat_rate: STANDARD_VAT.reduce((b, r) => (Math.abs(r - rate) < Math.abs(b - rate) ? r : b), 0.21),
          vat_amount: vat / 100,
          vat_exempt_reason: vat === 0 ? "Exenta" : null,
          withholding_rate: base ? Math.round((wh / base) * 100) / 100 : 0,
          withholding_amount: wh / 100,
        },
      ];
  if (!sameAmounts && vat !== 0 && base !== 0 && Math.abs(Math.round(base * lines[0].vat_rate) - vat) > 2) {
    return { ok: false, message: "El IVA no corresponde a un tipo estándar (21/10/4 %) de la base: revisa los importes." };
  }

  const isIncome = form.direction === "emitida";
  const invoice: NormalizedInvoice = {
    direction: form.direction,
    issuer_tax_id: form.issuer_tax_id.trim() || null,
    issuer_name: form.issuer_name.trim(),
    invoice_number: form.invoice_number.trim(),
    issue_date: form.issue_date,
    counterparty: isIncome
      ? { kind: "cliente", tax_id: form.counterparty_tax_id.trim() || null, name: form.counterparty_name.trim() || "Cliente" }
      : {
          kind: ex.folder_role === "profesional" ? "profesional" : "proveedor",
          tax_id: form.issuer_tax_id.trim() || null,
          name: form.issuer_name.trim(),
        },
    base_total: base / 100,
    vat_total: vat / 100,
    withholding_total: wh / 100,
    total: (base + vat - wh) / 100,
    status: draft?.status ?? "pendiente",
    paid_at: draft?.paid_at ?? null,
    due_date: draft?.due_date ?? null,
    payment_method: draft?.payment_method ?? null,
    expense_type: isIncome ? null : form.expense_type || null,
    source: ex.folder_role === "profesional" ? "pdf_profesional" : ex.folder_role === "emitida" ? "pdf_emitida" : "manual",
    notes: draft?.notes ?? null,
    review_reasons: [],
    lines,
  };

  const { data, error: rpcError } = await db.rpc("fn_book_extraction", {
    p_extraction: extractionId,
    p_invoice: invoice,
    p_actor: email,
  });
  if (rpcError) return { ok: false, message: rpcError.message };
  const result = (data as { result: string }).result;
  revalidatePath("/dashboard", "layout");
  const messages: Record<string, string> = {
    conflicto: "Ya existe una factura con ese emisor, número y año con otros importes: resuélvelo en Sincronización → Conflictos.",
    conflicto_pendiente: "Hay un conflicto pendiente con esa factura en Sincronización.",
    ignorada_anulada: "Esos datos corresponden a una factura anulada; corrige el número o los importes.",
    periodo_cerrado: "El trimestre de esa fecha está cerrado.",
  };
  if (messages[result]) return { ok: false, message: messages[result] };
  return { ok: true, data: { result } };
}
