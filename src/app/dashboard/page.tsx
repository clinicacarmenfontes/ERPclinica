import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard, PageHeader } from "@/components/erp/common";
import { requireAdminPage } from "@/lib/auth/session";
import { monthlyTotals } from "@/lib/data/invoices";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayMadrid } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Resumen | ERP Clínica Carmen Fontes" };

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x * 100, 0)) / 100;

// Resumen provisional con lo ya cargado. El panel completo (MTD/YTD, gráfica
// Ingresos vs Gastos, últimos movimientos, alertas de Claude) es el paso 5.
export default async function ResumenPage() {
  await requireAdminPage();
  const today = todayMadrid();
  const year = Number(today.slice(0, 4));
  const db = createAdminClient();
  const [months, conflicts, freshness] = await Promise.all([
    monthlyTotals(year),
    db.from("ingest_conflicts").select("id", { count: "exact", head: true }).eq("resolution", "pendiente"),
    db.from("v_data_freshness").select("kind, covered_until").returns<{ kind: string; covered_until: string | null }[]>(),
  ]);
  if (conflicts.error) throw conflicts.error;
  if (freshness.error) throw freshness.error;

  const inc = months.filter((m) => m.direction === "emitida");
  const exp = months.filter((m) => m.direction === "recibida");
  const income = sum(inc.map((m) => m.base));
  const expenses = sum(exp.map((m) => m.base));
  const review = sum(months.map((m) => m.needs_review));
  const until = (kind: string) => freshness.data.find((f) => f.kind === kind)?.covered_until ?? null;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader title="Resumen" description={`Ejercicio ${year} con los datos cargados hasta hoy.`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard
          label={`Ingresos ${year} (base)`}
          value={formatCurrency(income, { compact: true })}
          hint={`datos hasta ${formatDate(until("optimydent_facturas_emitidas"))}`}
          accent
        />
        <KpiCard
          label={`Gastos ${year} (base)`}
          value={formatCurrency(expenses, { compact: true })}
          hint={`datos hasta ${formatDate(until("optimydent_gastos"))} · sin nóminas`}
        />
        <KpiCard label="Resultado provisional" value={formatCurrency(income - expenses, { compact: true })} hint="antes de nóminas y SS" />
        <KpiCard label="Pendiente de cobro" value={formatCurrency(sum(inc.map((m) => m.outstanding)), { compact: true })} />
        <KpiCard label="Pendiente de pago" value={formatCurrency(sum(exp.map((m) => m.outstanding)), { compact: true })} />
      </div>

      {(conflicts.count ?? 0) + review > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-montserrat">
              <AlertTriangle className="size-4 text-warning" /> Pendiente de tu revisión
            </CardTitle>
            <CardDescription>Nada de esto bloquea los datos, pero conviene resolverlo antes del cierre trimestral.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {(conflicts.count ?? 0) > 0 && (
              <Link href="/dashboard/sincronizacion" className="text-primary underline">
                {conflicts.count} conflicto(s) de sincronización por resolver
              </Link>
            )}
            {review > 0 && (
              <Link href="/dashboard/gastos?f=revision" className="text-primary underline">
                {review} factura(s) marcadas para revisar (tipo de gasto nuevo, CIF erróneo, línea repetida…)
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Próximamente en este panel</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          KPIs mes y año en curso, gráfica de Ingresos vs Gastos por mes, cashflow proyectado, últimos movimientos con su
          estado y las alertas de facturas recurrentes que faltan (motor de Claude).
        </CardContent>
      </Card>
    </div>
  );
}
