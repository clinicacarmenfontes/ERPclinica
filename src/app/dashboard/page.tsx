import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Repeat } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CashflowChart, IncomeExpenseChart, type CashPoint, type MonthPoint } from "@/components/erp/charts";
import { PageHeader, StatusBadge, effectiveStatus } from "@/components/erp/common";
import { requireAdminPage } from "@/lib/auth/session";
import { cashflowHorizon, weeklyCashflow } from "@/lib/cashflow";
import { loadDashboard } from "@/lib/data/dashboard";
import { formatCurrency, formatDate } from "@/lib/format";
import { todayMadrid } from "@/lib/periods";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Resumen | ERP Clínica Carmen Fontes" };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKS = 13;

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x * 100, 0)) / 100;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Variación vs el mismo periodo del año anterior, en %. null si no hay base. */
function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function Delta({ value, upIsGood, vs }: { value: number | null; upIsGood: boolean; vs: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">sin datos de {vs}</span>;
  const up = value >= 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className={cn("inline-flex items-center font-medium", good ? "text-success" : "text-destructive")}>
        <Icon className="size-3.5" />
        {up ? "+" : ""}
        {value} %
      </span>
      vs {vs}
    </span>
  );
}

function StatCard({
  label,
  month,
  monthLabel,
  year,
  yearLabel,
  footer,
  accent = false,
}: {
  label: string;
  month: string;
  monthLabel: string;
  year: string;
  yearLabel: string;
  footer?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div>
          <p className={cn("font-montserrat text-2xl font-semibold", accent ? "text-primary" : "text-foreground")}>{year}</p>
          <p className="text-xs text-muted-foreground">{yearLabel}</p>
        </div>
        <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">{monthLabel}</span>
          <span className="text-sm font-medium tabular-nums">{month}</span>
        </div>
        {footer}
      </CardContent>
    </Card>
  );
}

export default async function ResumenPage() {
  await requireAdminPage();
  const today = todayMadrid();
  const year = Number(today.slice(0, 4));
  const monthNo = Number(today.slice(5, 7));
  const d = await loadDashboard(year);

  // ── Por mes: facturas (base) + nóminas cargadas como gasto ──
  const payrollOf = (m: number) =>
    sum(
      d.payroll
        .filter((p) => Number(p.period.slice(5, 7)) === m)
        .map((p) => p.gross_salaries + p.company_social_security + p.partner_remuneration),
    );
  const baseOf = (rows: typeof d.months, dir: "emitida" | "recibida", m: number) =>
    sum(rows.filter((r) => r.direction === dir && r.month === m).map((r) => r.base));
  const series: MonthPoint[] = MONTHS.map((name, i) => ({
    month: `${capital(name)} ${year}`,
    label: name.slice(0, 3),
    income: baseOf(d.months, "emitida", i + 1),
    expense: sum([baseOf(d.months, "recibida", i + 1), payrollOf(i + 1)]),
  }));
  const ytd = series.slice(0, monthNo);
  const incomeYtd = sum(ytd.map((p) => p.income));
  const expenseYtd = sum(ytd.map((p) => p.expense));
  const prevIncomeYtd = sum(Array.from({ length: monthNo }, (_, i) => baseOf(d.prevMonths, "emitida", i + 1)));
  const prevExpenseYtd = sum(Array.from({ length: monthNo }, (_, i) => baseOf(d.prevMonths, "recibida", i + 1)));
  const current = series[monthNo - 1];
  const hasPayroll = d.payroll.length > 0;

  // ── Pendiente y cashflow semanal (13 semanas) ──
  const receivable = sum(d.cashflow.filter((c) => c.amount > 0).map((c) => c.amount));
  const payable = sum(d.cashflow.filter((c) => c.amount < 0).map((c) => -c.amount));
  const overdue = d.cashflow.filter((c) => c.expected_date < today);
  const overdueIn = sum(overdue.filter((c) => c.amount > 0).map((c) => c.amount));
  const overdueOut = sum(overdue.filter((c) => c.amount < 0).map((c) => -c.amount));
  const horizon = cashflowHorizon(today, WEEKS);
  const cash: CashPoint[] = weeklyCashflow(d.cashflow, today, d.bankBalance?.total ?? 0, WEEKS);
  const later = d.cashflow.filter((c) => c.expected_date > horizon).length;

  const attention = d.reviewCount + d.conflictCount + d.alerts.length;
  const until = (k: string) => formatDate(d.freshness[k] ?? null);

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Resumen"
        description={`Ejercicio ${year}. Ingresos hasta ${until("optimydent_facturas_emitidas")} · gastos hasta ${until("optimydent_gastos")}. Importes en base imponible.`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Ingresos"
          year={formatCurrency(incomeYtd, { compact: true })}
          yearLabel={`Enero – ${MONTHS[monthNo - 1]} ${year}`}
          month={formatCurrency(current.income, { compact: true })}
          monthLabel={capital(MONTHS[monthNo - 1])}
          footer={<Delta value={delta(incomeYtd, prevIncomeYtd)} upIsGood vs={`${year - 1}`} />}
          accent
        />
        <StatCard
          label={hasPayroll ? "Gastos (con nóminas)" : "Gastos (sin nóminas)"}
          year={formatCurrency(expenseYtd, { compact: true })}
          yearLabel={`Enero – ${MONTHS[monthNo - 1]} ${year}`}
          month={formatCurrency(current.expense, { compact: true })}
          monthLabel={capital(MONTHS[monthNo - 1])}
          footer={<Delta value={hasPayroll ? null : delta(expenseYtd, prevExpenseYtd)} upIsGood={false} vs={`${year - 1}`} />}
        />
        <StatCard
          label="Resultado"
          year={formatCurrency(incomeYtd - expenseYtd, { compact: true })}
          yearLabel={hasPayroll ? "Ingresos − gastos − nóminas" : "Antes de nóminas y Seguridad Social"}
          month={formatCurrency(current.income - current.expense, { compact: true })}
          monthLabel={capital(MONTHS[monthNo - 1])}
        />
        <StatCard
          label="Tesorería"
          year={d.bankBalance ? formatCurrency(d.bankBalance.total, { compact: true }) : "—"}
          yearLabel={
            d.bankBalance
              ? `Saldo en ${d.bankBalance.accounts} cuenta(s) · último movimiento ${formatDate(d.bankBalance.asOf)}`
              : "Aún no hay extractos bancarios cargados"
          }
          month={`${formatCurrency(receivable, { compact: true })} / ${formatCurrency(payable, { compact: true })}`}
          monthLabel="Pendiente de cobro / pago"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="font-montserrat">Ingresos y gastos por mes</CardTitle>
            <CardDescription>
              {year}, base imponible{hasPayroll ? "; los gastos incluyen las nóminas cargadas" : "; los gastos aún no incluyen nóminas"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={series} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-montserrat">
              {attention > 0 ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
              Requiere atención
            </CardTitle>
            <CardDescription>Conviene resolverlo antes de cerrar el trimestre.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {attention === 0 && <p className="text-muted-foreground">Todo al día.</p>}
            {d.reviewCount > 0 && (
              <Link href="/dashboard/revision" className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50">
                <span>Facturas para revisar</span>
                <span className="font-semibold tabular-nums">{d.reviewCount}</span>
              </Link>
            )}
            {d.conflictCount > 0 && (
              <Link href="/dashboard/sincronizacion" className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50">
                <span>Conflictos de sincronización</span>
                <span className="font-semibold tabular-nums">{d.conflictCount}</span>
              </Link>
            )}
            {d.alerts.length > 0 && (
              <a href="#recurrentes" className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50">
                <span>Avisos de gastos recurrentes</span>
                <span className="font-semibold tabular-nums">{d.alerts.length}</span>
              </a>
            )}
            {(overdueIn > 0 || overdueOut > 0) && (
              <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
                <span>Vencido sin cobrar / pagar</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatCurrency(overdueIn)} por cobrar · {formatCurrency(overdueOut)} por pagar
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="font-montserrat">Cashflow previsto · 13 semanas</CardTitle>
            <CardDescription>
              {d.bankBalance
                ? `Parte del saldo bancario (${formatCurrency(d.bankBalance.total)}) y suma cobros y resta pagos pendientes por fecha de vencimiento.`
                : "Sin extractos bancarios cargados parte de 0 €: muestra solo el neto acumulado de cobros y pagos pendientes."}{" "}
              Lo vencido se cuenta en la primera semana.{later > 0 && ` Hay ${later} vencimiento(s) más allá de 13 semanas.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.cashflow.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay cobros ni pagos pendientes.</p>
            ) : (
              <CashflowChart data={cash} />
            )}
          </CardContent>
        </Card>

        <Card id="recurrentes">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-montserrat">
              <Repeat className="size-4 text-muted-foreground" /> Gastos recurrentes
            </CardTitle>
            <CardDescription>
              Proveedores que facturan casi todos los meses: falta su factura o el importe se sale de lo habitual. Solo se
              miran meses completos ya cargados.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {d.alerts.length === 0 ? (
              <p className="text-muted-foreground">Sin avisos.</p>
            ) : (
              d.alerts.slice(0, 8).map((a) => (
                <div key={`${a.kind}-${a.key}-${a.month}`} className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
                  <span className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {a.kind === "falta"
                      ? `Sin factura en ${MONTHS[Number(a.month.slice(5, 7)) - 1]} (habitual ${formatCurrency(a.expected)})`
                      : `${capital(MONTHS[Number(a.month.slice(5, 7)) - 1])}: ${formatCurrency(a.actual)} frente a ${formatCurrency(a.expected)} habitual`}
                  </span>
                </div>
              ))
            )}
            {d.alerts.length > 8 && <p className="text-xs text-muted-foreground">y {d.alerts.length - 8} más.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-montserrat">Últimas facturas</CardTitle>
            <CardDescription>
              <Link className="text-primary underline" href="/dashboard/ingresos">
                Ingresos
              </Link>{" "}
              ·{" "}
              <Link className="text-primary underline" href="/dashboard/gastos">
                Gastos
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border text-sm">
            {d.recentInvoices.length === 0 && <p className="text-muted-foreground">Aún no hay facturas cargadas.</p>}
            {d.recentInvoices.map((i) => {
              const income = i.direction === "emitida";
              return (
                <div key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{income ? (i.parties?.name ?? "—") : i.issuer_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {income ? "Ingreso" : "Gasto"} · {i.invoice_number} · {formatDate(i.issue_date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-medium tabular-nums">{formatCurrency(income ? i.total : -i.total)}</span>
                    <StatusBadge status={effectiveStatus(i.status, i.due_date, today)} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-montserrat">Últimos movimientos bancarios</CardTitle>
            <CardDescription>
              <Link className="text-primary underline" href="/dashboard/tesoreria">
                Tesorería
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border text-sm">
            {d.recentBank.length === 0 && (
              <p className="text-muted-foreground">
                Aún no hay movimientos. Súbelos en{" "}
                <Link className="text-primary underline" href="/dashboard/sincronizacion">
                  Sincronización
                </Link>{" "}
                (PDF de Kutxabank o CSV de CaixaBank) para contrastar con las facturas.
              </p>
            )}
            {d.recentBank.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.bank_accounts?.name ?? "—"} · {formatDate(t.booking_date)}
                  </p>
                </div>
                <span className={cn("shrink-0 font-medium tabular-nums", t.amount < 0 ? "text-foreground" : "text-success")}>
                  {formatCurrency(t.amount)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
