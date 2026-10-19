import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, REVIEW_REASONS } from "@/components/erp/common";
import { InvoiceActions } from "@/components/erp/invoice-actions";
import { requireAdminPage } from "@/lib/auth/session";
import { listReviewInvoices } from "@/lib/data/invoices";
import { formatCurrency, formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Revisión | ERP Clínica Carmen Fontes" };

// Qué significa cada motivo y cómo se resuelve. Sin entrada → texto genérico.
const HOW_TO: Record<string, string> = {
  tipo_gasto_nuevo:
    "Optimydent usa un tipo de gasto que el ERP no conocía, así que no tiene cuenta contable. Asígnale cuenta y partida en Configuración (se corrigen a la vez todas sus facturas), o cambia el tipo de esta factura en ⋯ → Corregir datos.",
  tipo_gasto_sin_cuenta:
    "El tipo de gasto no tiene cuenta contable. Asígnasela en Configuración (se corrigen a la vez todas sus facturas), o cambia el tipo en ⋯ → Corregir datos.",
  sin_numero:
    "Cargo sin nº de factura (seguros, recibos…). Si tienes el nº, ponlo en ⋯ → Corregir datos; si no lo tiene, comprueba el cargo y dalo por revisado.",
  numero_factura_repetido:
    "Hay otra factura viva con el mismo emisor y nº. En ⋯ → Corregir datos cambia el nº o la fecha de la errónea; anula la que sobre, o da las dos por revisadas si son correctas.",
  nif_emisor_es_la_clinica:
    "El proveedor está grabado en Optimydent con el CIF de la clínica. Pon su CIF en ⋯ → Corregir datos y corrige también su ficha en Optimydent.",
  linea_repetida_en_origen:
    "Optimydent exportó la misma línea dos veces y el total sale duplicado. En ⋯ → Corregir datos marca la línea repetida para quitarla: queda una sola y el total se recalcula. Bórrala también en Optimydent.",
  tipos_distintos_en_factura:
    "Optimydent asigna varios tipos de gasto a la misma factura; se ha usado el primero. Elige el correcto en ⋯ → Corregir datos.",
  iva_no_cuadra:
    "El IVA no corresponde al tipo indicado. Revísalo en Optimydent; si está bien, dala por revisada.",
  sin_nif: "Falta el NIF. Añádelo en ⋯ → Corregir datos (y en Optimydent).",
};
const GENERIC = "Compruébala; corrige lo que haga falta en ⋯ → Corregir datos o, si está bien, dala por revisada.";

export default async function RevisionPage(props: PageProps<"/dashboard/revision">) {
  await requireAdminPage();
  const { motivo } = await props.searchParams;
  const [rows, conflicts] = await Promise.all([
    listReviewInvoices(),
    createAdminClient().from("ingest_conflicts").select("id", { count: "exact", head: true }).eq("resolution", "pendiente"),
  ]);
  if (conflicts.error) throw conflicts.error;

  const counts = new Map<string, number>();
  for (const r of rows) for (const reason of new Set(r.review_reasons)) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const selected = typeof motivo === "string" && counts.has(motivo) ? motivo : null;
  const visible = selected ? rows.filter((r) => r.review_reasons.includes(selected)) : rows;
  const typeReason = selected === "tipo_gasto_nuevo" || selected === "tipo_gasto_sin_cuenta";

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Revisión"
        description="Facturas marcadas para revisar, de cualquier trimestre. Nada de esto bloquea los datos, pero conviene resolverlo antes del cierre trimestral."
      />

      {(conflicts.count ?? 0) > 0 && (
        <Link
          href="/dashboard/sincronizacion"
          className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm hover:bg-warning/15"
        >
          Además hay <strong>{conflicts.count}</strong> conflicto(s) de sincronización por resolver en Sincronización.
        </Link>
      )}

      {rows.length === 0 ? (
        <EmptyState>No hay facturas pendientes de revisar.</EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/revision"
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                !selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              Todas · {rows.length}
            </Link>
            {reasons.map(([reason, n]) => (
              <Link
                key={reason}
                href={`/dashboard/revision?motivo=${reason}`}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selected === reason
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {REVIEW_REASONS[reason] ?? reason} · {n}
              </Link>
            ))}
          </div>

          {selected && (
            <Card>
              <CardHeader>
                <CardTitle className="font-montserrat text-base">{REVIEW_REASONS[selected] ?? selected}</CardTitle>
                <CardDescription>{HOW_TO[selected] ?? GENERIC}</CardDescription>
              </CardHeader>
              {typeReason && (
                <CardContent>
                  <Link href="/dashboard/configuracion#tipos" className="text-sm text-primary underline">
                    Ir a Configuración → Tipos de gasto
                  </Link>
                </CardContent>
              )}
            </Card>
          )}

          <div className="rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nº factura</TableHead>
                  <TableHead>Tercero</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Qué revisar</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const income = r.direction === "emitida";
                  const party = income ? (r.parties?.name ?? "—") : r.issuer_name;
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="whitespace-nowrap">{formatDate(r.issue_date)}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {r.invoice_number}
                        <div className="text-xs font-normal text-muted-foreground">{income ? "Ingreso" : "Gasto"}</div>
                      </TableCell>
                      <TableCell className="max-w-56">
                        <div className="truncate">{party}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {income ? (r.parties?.tax_id ?? "sin NIF") : (r.expense_types?.name ?? "Sin tipo de gasto")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(r.total)}</TableCell>
                      <TableCell className="max-w-96">
                        <div className="flex flex-wrap gap-1">
                          {r.review_reasons.map((reason) => (
                            <Link key={reason} href={`/dashboard/revision?motivo=${reason}`}>
                              <Badge className="bg-warning/15 text-warning hover:bg-warning/25">{REVIEW_REASONS[reason] ?? reason}</Badge>
                            </Link>
                          ))}
                        </div>
                        {r.notes && <p className="mt-1 text-xs text-muted-foreground">{r.notes}</p>}
                      </TableCell>
                      <TableCell>
                        <InvoiceActions
                          invoice={{
                            id: r.id,
                            invoice_number: r.invoice_number,
                            issue_date: r.issue_date,
                            party,
                            total: r.total,
                            needs_review: r.needs_review,
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {!selected && <p className="text-xs text-muted-foreground">Pulsa un motivo para ver qué significa y cómo resolverlo.</p>}
        </>
      )}
    </div>
  );
}
