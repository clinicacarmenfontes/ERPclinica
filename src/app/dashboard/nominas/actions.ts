"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { PAYROLL_FIELDS, type PayrollInput } from "@/lib/payroll";
import { createAdminClient } from "@/lib/supabase/admin";

const FIELDS = PAYROLL_FIELDS.map((f) => f.key);

/** Guarda el resumen de nóminas de un mes (lo que pasa el gestor). */
export async function savePayrollMonth(period: string, values: PayrollInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const { email } = await requireAdmin();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { ok: false, message: "Mes no válido." };
  for (const k of FIELDS) {
    const v = values[k];
    if (!Number.isFinite(v) || v < 0) return { ok: false, message: "Los importes tienen que ser números positivos." };
  }
  const row = Object.fromEntries(FIELDS.map((k) => [k, Math.round(values[k] * 100) / 100]));
  const db = createAdminClient();
  const { data: before } = await db.from("payroll_months").select("*").eq("period", period).maybeSingle();
  const { error } = await db.from("payroll_months").upsert({ period, ...row }, { onConflict: "period" });
  if (error) {
    const closed = /cerrado/.test(error.message);
    return { ok: false, message: closed ? `El trimestre de ${period} está cerrado: reábrelo en Fiscal para cambiar sus nóminas.` : error.message };
  }
  await db.from("audit_log").insert({
    actor: email,
    action: "editar_nominas",
    entity: "payroll_months",
    entity_id: period,
    before: before ?? null,
    after: row,
  });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
