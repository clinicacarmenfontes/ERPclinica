"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// Acciones sobre una factura desde los listados de Gastos e Ingresos. La
// lógica (lápida, rectificación del asiento, auditoría) vive en SQL.

type Result = { ok: true } | { ok: false; message: string };

const MIN_REASON = 10;

async function call(fn: string, args: Record<string, unknown>): Promise<Result> {
  const { error } = await createAdminClient().rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function markInvoiceReviewed(invoiceId: string, note: string): Promise<Result> {
  const { email } = await requireAdmin();
  return call("fn_mark_invoice_reviewed", { p_invoice: invoiceId, p_note: note, p_actor: email });
}

export async function voidInvoice(invoiceId: string, reason: string): Promise<Result> {
  const { email } = await requireAdmin();
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, message: `Indica el motivo de la anulación (mín. ${MIN_REASON} caracteres).` };
  }
  return call("fn_void_invoice", { p_invoice: invoiceId, p_reason: reason, p_actor: email });
}

export async function correctInvoiceIdentity(
  invoiceId: string,
  form: { invoiceNumber: string; issueDate: string; reason: string },
): Promise<Result> {
  const { email } = await requireAdmin();
  if (!form.invoiceNumber.trim()) return { ok: false, message: "Indica el nº de factura." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.issueDate)) return { ok: false, message: "Indica una fecha válida." };
  if (form.reason.trim().length < MIN_REASON) {
    return { ok: false, message: `Indica el motivo de la corrección (mín. ${MIN_REASON} caracteres).` };
  }
  return call("fn_correct_invoice_identity", {
    p_invoice: invoiceId,
    p_number: form.invoiceNumber,
    p_date: form.issueDate,
    p_reason: form.reason,
    p_actor: email,
  });
}
