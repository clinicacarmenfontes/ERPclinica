import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/erp/common";
import { PayrollRow } from "@/components/erp/payroll-editor";
import { PAYROLL_FIELDS, type PayrollInput } from "@/lib/payroll";
import { requireAdminPage } from "@/lib/auth/session";
import { formatCurrency } from "@/lib/format";
import { todayMadrid } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Nóminas | ERP Clínica Carmen Fontes" };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export default async function NominasPage(props: PageProps<"/dashboard/nominas">) {
  await requireAdminPage();
  const current = Number(todayMadrid().slice(0, 4));
  const raw = (await props.searchParams).anio;
  const year = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : current;
  const db = createAdminClient();
  const [payroll, periods] = await Promise.all([
    db
      .from("payroll_months")
      .select("period, gross_salaries, company_social_security, worker_social_security, worker_withholding, partner_remuneration")
      .like("period", `${year}-%`)
      .returns<(PayrollInput & { period: string })[]>(),
    db.from("tax_periods").select("quarter, status").eq("year", year).returns<{ quarter: number; status: string }[]>(),
  ]);
  if (payroll.error) throw payroll.error;
  if (periods.error) throw periods.error;

  const rows = MONTHS.map((name, i) => {
    const period = `${year}-${String(i + 1).padStart(2, "0")}`;
    const p = payroll.data.find((x) => x.period === period);
    const values = p
      ? (Object.fromEntries(PAYROLL_FIELDS.map((f) => [f.key, Number(p[f.key])])) as PayrollInput)
      : null;
    const quarter = Math.floor(i / 3) + 1;
    return { period, name, values, locked: periods.data.some((t) => t.quarter === quarter && t.status === "cerrado") };
  });
  const total = (k: keyof PayrollInput) => rows.reduce((s, r) => s + Math.round((r.values?.[k] ?? 0) * 100), 0) / 100;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Nóminas"
        description="Resumen mensual que te pasa el gestor. Alimenta el margen, el EBITDA y la retribución de la socia en el Resumen, y las retenciones de trabajadores del Modelo 111."
      >
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {[current - 1, current].map((y) => (
            <Link
              key={y}
              href={`/dashboard/nominas?anio=${y}`}
              className={cn(
                "rounded-md px-3 py-1 font-montserrat text-xs font-medium",
                y === year ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {y}
            </Link>
          ))}
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">{year}</CardTitle>
          <CardDescription>
            Importes en euros (admite coma decimal). Los meses de un trimestre cerrado no se pueden cambiar salvo que lo
            reabras en Fiscal.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                {PAYROLL_FIELDS.map((f) => (
                  <TableHead key={f.key}>{f.label}</TableHead>
                ))}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <PayrollRow key={r.period} period={r.period} label={r.name} initial={r.values} locked={r.locked} />
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                {PAYROLL_FIELDS.map((f) => (
                  <TableCell key={f.key} className="pr-6 text-right tabular-nums">
                    {formatCurrency(total(f.key))}
                  </TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
