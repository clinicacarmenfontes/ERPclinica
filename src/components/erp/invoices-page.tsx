import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InvoiceActions } from "@/components/erp/invoice-actions";
import {
  EmptyState,
  KpiCard,
  PageHeader,
  QuarterTabs,
  REVIEW_REASONS,
  StatusBadge,
  effectiveStatus,
} from "@/components/erp/common";
import { listInvoices, type InvoiceFilter } from "@/lib/data/invoices";
import { formatCurrency, formatDate } from "@/lib/format";
import { parseQuarterParam, quarterLabel, quarterParam, quarterRange, todayMadrid } from "@/lib/periods";
import { cn } from "@/lib/utils";

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "pendientes", label: "Pendientes" },
  { key: "revision", label: "Para revisar" },
  { key: "anuladas", label: "Anuladas" },
];

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + Number(x) * 100, 0)) / 100;

/** Listado trimestral de facturas emitidas o recibidas (misma pantalla para ambas). */
export async function InvoicesPage({
  direction,
  searchParams,
}: {
  direction: "emitida" | "recibida";
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const quarter = parseQuarterParam(searchParams.t);
  const filter = (FILTERS.find((f) => f.key === searchParams.f)?.key ?? "todas") as InvoiceFilter;
  const { from, to } = quarterRange(quarter);
  const rows = await listInvoices({ direction, from, to, filter });
  const today = todayMadrid();
  const isIncome = direction === "emitida";
  const basePath = isIncome ? "/dashboard/ingresos" : "/dashboard/gastos";
  const live = rows.filter((r) => r.status !== "anulada");

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title={isIncome ? "Ingresos" : "Gastos"}
        description={
          isIncome
            ? "Facturas emitidas a pacientes (Optimydent) y a otras clínicas."
            : "Facturas recibidas: proveedores (Optimydent) y profesionales con retención."
        }
      >
        <QuarterTabs basePath={basePath} current={quarter} extra={filter !== "todas" ? `&f=${filter}` : ""} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={`Base imponible · ${quarterLabel(quarter)}`} value={formatCurrency(sum(live.map((r) => r.base_total)))} accent />
        <KpiCard label={isIncome ? "IVA repercutido" : "IVA soportado"} value={formatCurrency(sum(live.map((r) => r.vat_total)))} />
        <KpiCard
          label={isIncome ? "Total facturado" : "Retenciones practicadas"}
          value={formatCurrency(sum(live.map((r) => (isIncome ? r.total : r.withholding_total))))}
        />
        <KpiCard
          label={isIncome ? "Pendiente de cobro" : "Pendiente de pago"}
          value={formatCurrency(sum(live.filter((r) => r.status !== "pagada").map((r) => r.total - r.paid_amount)))}
          hint={`${live.length} facturas`}
        />
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`${basePath}?t=${quarterParam(quarter)}${f.key !== "todas" ? `&f=${f.key}` : ""}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          No hay facturas en {quarterLabel(quarter)} con este filtro. Súbelas desde{" "}
          <Link className="text-primary underline" href="/dashboard/sincronizacion">
            Sincronización
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Nº factura</TableHead>
                <TableHead>{isIncome ? "Paciente / cliente" : "Proveedor"}</TableHead>
                <TableHead>{isIncome ? "Forma de pago" : "Tipo de gasto"}</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                {!isIncome && <TableHead className="text-right">Ret.</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const party = isIncome ? r.parties : { name: r.issuer_name, tax_id: r.issuer_tax_id };
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.issue_date)}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {r.invoice_number}
                        {r.needs_review && (
                          <span title={[...r.review_reasons.map((x) => REVIEW_REASONS[x] ?? x), r.notes].filter(Boolean).join(" · ")}>
                            <AlertTriangle className="size-3.5 text-warning" />
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64">
                      <div className="truncate">{party?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{party?.tax_id ?? "sin NIF"}</div>
                    </TableCell>
                    <TableCell className="max-w-48">
                      {isIncome ? (
                        <span className="text-sm">{r.payment_method ?? "—"}</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate text-sm">{r.expense_types?.name ?? "Sin tipo"}</span>
                          {r.expense_categories && (
                            <Badge variant="outline" className="gap-1">
                              <span className="size-2 rounded-full" style={{ backgroundColor: r.expense_categories.color }} />
                              {r.expense_categories.name}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.base_total)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.vat_total)}</TableCell>
                    {!isIncome && (
                      <TableCell className="text-right tabular-nums">
                        {Number(r.withholding_total) ? formatCurrency(r.withholding_total) : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-medium tabular-nums">{formatCurrency(r.total)}</TableCell>
                    <TableCell>
                      <StatusBadge status={effectiveStatus(r.status, r.due_date, today)} />
                    </TableCell>
                    <TableCell>
                      {r.status !== "anulada" && (
                        <InvoiceActions
                          invoice={{
                            id: r.id,
                            invoice_number: r.invoice_number,
                            issue_date: r.issue_date,
                            party: party?.name ?? r.issuer_name,
                            total: r.total,
                            needs_review: r.needs_review,
                          }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
