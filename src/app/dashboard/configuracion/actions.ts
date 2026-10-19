"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

/** Cuenta y partida de un tipo de gasto; corrige a la vez sus facturas. */
export async function setExpenseType(
  typeId: string,
  form: { accountCode: string; categoryId: string },
): Promise<{ ok: true; invoices: number } | { ok: false; message: string }> {
  const { email } = await requireAdmin();
  if (!form.accountCode || !form.categoryId) return { ok: false, message: "Elige la cuenta y la partida." };
  const { data, error } = await createAdminClient().rpc("fn_set_expense_type", {
    p_type: typeId,
    p_account: form.accountCode,
    p_category: form.categoryId,
    p_actor: email,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/dashboard", "layout");
  return { ok: true, invoices: Number(data ?? 0) };
}

/** % de prorrata de IVA (lo fija el gestor): el 303 deduce ese % del IVA soportado. */
export async function setVatProrrata(pct: number): Promise<{ ok: true } | { ok: false; message: string }> {
  const { email } = await requireAdmin();
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, message: "La prorrata va de 0 a 100 %." };
  const db = createAdminClient();
  const { data: before } = await db.from("company_settings").select("vat_prorrata_pct").single();
  const { error } = await db.from("company_settings").update({ vat_prorrata_pct: Math.round(pct * 100) / 100 }).eq("id", true);
  if (error) return { ok: false, message: error.message };
  await db.from("audit_log").insert({
    actor: email,
    action: "editar_prorrata",
    entity: "company_settings",
    before: before ?? null,
    after: { vat_prorrata_pct: pct },
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
