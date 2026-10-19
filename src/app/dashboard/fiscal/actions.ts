"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { generateGestorExcel } from "@/lib/gestor/generate";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true } | { ok: false; message: string };

export async function closeQuarter(year: number, quarter: number): Promise<Result> {
  const { email } = await requireAdmin();
  const { error } = await createAdminClient().rpc("fn_close_tax_period", { p_year: year, p_quarter: quarter, p_actor: email });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function reopenQuarter(year: number, quarter: number, reason: string): Promise<Result> {
  const { email } = await requireAdmin();
  if (reason.trim().length < 10) return { ok: false, message: "Indica el motivo de la reapertura (mín. 10 caracteres)." };
  const { error } = await createAdminClient().rpc("fn_reopen_tax_period", {
    p_year: year,
    p_quarter: quarter,
    p_reason: reason,
    p_actor: email,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

export async function generateGestorExcelAction(
  year: number,
  quarter: number,
): Promise<{ ok: true; id: string; version: number; fileName: string } | { ok: false; message: string; details?: string[] }> {
  const { email } = await requireAdmin();
  const r = await generateGestorExcel(year, quarter, email);
  if (!r.ok) {
    const details = r.verification
      ? [...r.verification.checks.filter((c) => !c.ok).map((c) => `${c.name}: esperado ${c.expected}, en el Excel ${c.actual}`), ...r.verification.mismatches]
      : undefined;
    return { ok: false, message: r.message, details };
  }
  revalidatePath("/dashboard/fiscal");
  return { ok: true, id: r.id, version: r.version, fileName: r.fileName };
}
