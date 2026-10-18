import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConflictCard } from "@/components/erp/conflict-card";
import { EmptyState, PageHeader } from "@/components/erp/common";
import { UploadPanel } from "@/components/erp/upload-panel";
import { requireAdminPage } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { todayMadrid } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Sincronización | ERP Clínica Carmen Fontes" };

const KIND_LABELS: Record<string, string> = {
  optimydent_facturas_emitidas: "Facturas emitidas (Optimydent)",
  optimydent_gastos: "Gastos (Optimydent)",
  optimydent_saldos_acreedores: "Pacientes acreedores",
  optimydent_saldos_deudores: "Pacientes deudores",
  movimientos_banco: "Movimientos bancarios",
};

const CHANNEL_LABELS: Record<string, string> = {
  optimydent_fichero: "Fichero Optimydent",
  optimydent_rpa: "Sincronizar Gestión",
  repositorio: "Repositorio",
  banco: "Banco",
};

const RUN_STATUS: Record<string, string> = {
  en_curso: "bg-muted text-muted-foreground",
  completado: "bg-success/15 text-success",
  completado_con_avisos: "bg-warning/15 text-warning",
  fallido: "bg-destructive/10 text-destructive",
};

type Run = { id: string; channel: string; status: string; started_at: string; stats: Record<string, unknown>; error: string | null };
type Freshness = { kind: string; covered_until: string | null; last_loaded_at: string; files: number };
type Conflict = {
  id: string;
  created_at: string;
  differences: Record<string, [unknown, unknown]>;
  invoices: { invoice_number: string; issuer_name: string; issue_date: string; total: number } | null;
};

export default async function SincronizacionPage() {
  await requireAdminPage();
  const db = createAdminClient();
  const [runs, freshness, conflicts] = await Promise.all([
    db.from("sync_runs").select("id, channel, status, started_at, stats, error").order("started_at", { ascending: false }).limit(15).returns<Run[]>(),
    db.from("v_data_freshness").select("*").returns<Freshness[]>(),
    db
      .from("ingest_conflicts")
      .select("id, created_at, differences, invoices(invoice_number, issuer_name, issue_date, total)")
      .eq("resolution", "pendiente")
      .order("created_at")
      .returns<Conflict[]>(),
  ]);
  for (const r of [runs, freshness, conflicts]) if (r.error) throw r.error;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Sincronización"
        description="Entrada de datos: ficheros de Optimydent y de los bancos. El botón «Sincronizar Gestión» (RPA) y el repositorio de facturas de OneDrive se añaden en los siguientes pasos."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <UploadPanel today={todayMadrid()} />

        <Card>
          <CardHeader>
            <CardTitle className="font-montserrat">Datos cargados hasta…</CardTitle>
            <CardDescription>Los KPIs y avisos usan esta fecha por fuente: un mes sin cargar no cuenta como mes sin gastos.</CardDescription>
          </CardHeader>
          <CardContent>
            {freshness.data!.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no se ha cargado nada.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {freshness.data!.map((f) => (
                  <li key={f.kind} className="flex items-center justify-between gap-2">
                    <span>{KIND_LABELS[f.kind] ?? f.kind}</span>
                    <span className="text-right">
                      <span className="font-medium">{formatDate(f.covered_until)}</span>
                      <span className="block text-xs text-muted-foreground">subido {formatDateTime(f.last_loaded_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-montserrat text-base font-semibold">
          Conflictos por resolver {conflicts.data!.length > 0 && <Badge className="ml-1">{conflicts.data!.length}</Badge>}
        </h2>
        {conflicts.data!.length === 0 ? (
          <EmptyState>No hay conflictos pendientes.</EmptyState>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {conflicts.data!.map((c) => (
              <ConflictCard key={c.id} conflict={{ id: c.id, created_at: c.created_at, differences: c.differences, invoice: c.invoices }} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-montserrat text-base font-semibold">Últimas ejecuciones</h2>
        {runs.data!.length === 0 ? (
          <EmptyState>Aún no hay ejecuciones.</EmptyState>
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Fichero</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data!.map((r) => {
                  const { fichero, avisos, ...counts } = r.stats as Record<string, unknown>;
                  void avisos;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(r.started_at)}</TableCell>
                      <TableCell>{CHANNEL_LABELS[r.channel] ?? r.channel}</TableCell>
                      <TableCell className="max-w-56 truncate">{String(fichero ?? "—")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.error ??
                          Object.entries(counts)
                            .filter(([, n]) => typeof n === "number" && n > 0)
                            .map(([k, n]) => `${k.replace(/_/g, " ")}: ${n}`)
                            .join(" · ")}
                      </TableCell>
                      <TableCell>
                        <Badge className={RUN_STATUS[r.status]}>{r.status.replace(/_/g, " ")}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
