import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, KpiCard, PageHeader, QuarterTabs } from "@/components/erp/common";
import { ExtractionCard, type ExtractionView } from "@/components/erp/extraction-card";
import { RefreshInventoryButton, RepositoryFiles, type RepositoryFile } from "@/components/erp/repository-files";
import { requireAdminPage } from "@/lib/auth/session";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import type { NormalizedInvoice } from "@/lib/ingest/types";
import { parseQuarterParam, quarterLabel, quarterRange } from "@/lib/periods";
import type { RepositoryRole } from "@/lib/repository/paths";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Repositorio | ERP Clínica Carmen Fontes" };
// Leer una tanda de facturas con Claude (Server Action de esta página) puede tardar.
export const maxDuration = 300;

type Item = {
  drive_item_id: string;
  name: string;
  status: string;
  role: RepositoryRole;
  path: string;
  error: string | null;
  year: number | null;
  quarter: number | null;
  source_documents: { document_extractions: { status: string } | null } | null;
};

type Extraction = {
  id: string;
  extracted: { draft?: NormalizedInvoice | null; document_type: string; notes: string | null };
  confidence: number | null;
  folder_role: RepositoryRole;
  repository_path: string | null;
  match_candidates: ExtractionView["candidates"];
  review_reasons: string[];
  source_documents: { id: string; file_name: string };
};

export default async function RepositorioPage(props: PageProps<"/dashboard/repositorio">) {
  await requireAdminPage();
  const quarter = parseQuarterParam((await props.searchParams).t);
  const { from, to } = quarterRange(quarter);
  const db = createAdminClient();

  const [token, items, extractions, missing, types] = await Promise.all([
    db.from("integration_tokens").select("account_email, updated_at, last_error").eq("provider", "microsoft_graph").maybeSingle(),
    db
      .from("repository_items")
      .select("drive_item_id, name, status, role, path, error, year, quarter, source_documents(document_extractions(status))")
      .neq("role", "ignorado")
      .order("path")
      .returns<Item[]>(),
    db
      .from("document_extractions")
      .select("id, extracted, confidence, folder_role, repository_path, match_candidates, review_reasons, source_documents(id, file_name)")
      .eq("status", "pendiente")
      .order("created_at")
      .limit(100)
      .returns<Extraction[]>(),
    db.from("v_invoices_without_receipt").select("*").gte("issue_date", from).lte("issue_date", to).order("issue_date").returns<{ id: string; issue_date: string; issuer_name: string; invoice_number: string; total: number }[]>(),
    db.from("expense_types").select("name").order("name").returns<{ name: string }[]>(),
  ]);
  for (const r of [token, items, extractions, missing, types]) if (r.error) throw r.error;

  const inQuarter = items.data!.filter((i) => i.year === quarter.year && i.quarter === quarter.quarter);
  const files: RepositoryFile[] = inQuarter.map((i) => ({
    id: i.drive_item_id,
    name: i.name,
    path: i.path,
    role: i.role,
    error: i.error,
    state: i.status === "error" ? "error" : (i.source_documents?.document_extractions?.status ?? "sin_leer"),
  }));
  const errors = items.data!.filter((i) => i.status === "error");
  const connected = !!token.data && !token.data.last_error;
  const configured = !!process.env.ONEDRIVE_FOLDER_URL && !!process.env.ANTHROPIC_API_KEY;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Repositorio de facturas"
        description="Apoyo opcional al flujo principal (listados de Optimydent): consulta la carpeta «01. Facturas» del OneDrive de info@ y lee con Claude solo las facturas que elijas, para vincularlas como justificante o contabilizar las que no están en Optimydent (doctoras, emitidas)."
      >
        <RefreshInventoryButton disabled={!connected || !configured} />
      </PageHeader>

      {!configured ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Falta configurar ONEDRIVE_FOLDER_URL y/o ANTHROPIC_API_KEY en Vercel (ver docs/puesta-en-marcha.md, paso 4).
          </AlertDescription>
        </Alert>
      ) : !connected ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            {token.data?.last_error
              ? `OneDrive desconectado: ${token.data.last_error}. `
              : "OneDrive aún no está conectado. "}
            Cierra sesión y vuelve a entrar con admin@: al iniciar sesión se concede el acceso de lectura.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" /> Conectado como {token.data!.account_email} · actualizado{" "}
          {formatDateTime(token.data!.updated_at)}
        </p>
      )}

      <div className="flex justify-end">
        <QuarterTabs basePath="/dashboard/repositorio" current={quarter} />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label={`Ficheros en ${quarterLabel(quarter)}`} value={String(files.length)} hint={`${files.filter((f) => f.state !== "sin_leer").length} leídos`} />
        <KpiCard label="Pendientes de revisar (todos)" value={String(extractions.data!.length)} accent />
        <KpiCard label={`Gastos sin PDF · ${quarterLabel(quarter)}`} value={String(missing.data!.length)} hint="registrados en Optimydent" />
        <KpiCard label="Ficheros con error" value={String(errors.length)} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-montserrat text-base font-semibold">Ficheros de {quarterLabel(quarter)}</h2>
        {files.length === 0 ? (
          <EmptyState>No hay ficheros listados en este trimestre. Pulsa «Actualizar listado».</EmptyState>
        ) : (
          <RepositoryFiles files={files} canRead={connected && configured} />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-montserrat text-base font-semibold">
          Bandeja de revisión {extractions.data!.length > 0 && <Badge className="ml-1">{extractions.data!.length}</Badge>}
        </h2>
        {extractions.data!.length === 0 ? (
          <EmptyState>Nada pendiente. Al leer una factura que casa con Optimydent se vincula sola como justificante.</EmptyState>
        ) : (
          <div className="grid gap-4 2xl:grid-cols-2">
            {extractions.data!.map((e) => (
              <ExtractionCard
                key={e.id}
                expenseTypes={types.data!.map((t) => t.name)}
                item={{
                  id: e.id,
                  documentId: e.source_documents.id,
                  fileName: e.source_documents.file_name,
                  path: e.repository_path,
                  role: e.folder_role,
                  confidence: e.confidence,
                  reasons: e.review_reasons,
                  draft: e.extracted.draft ?? null,
                  documentType: e.extracted.document_type,
                  notes: e.extracted.notes,
                  candidates: e.match_candidates,
                }}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Gastos de Optimydent sin PDF en OneDrive · {quarterLabel(quarter)}</CardTitle>
          <CardDescription>Registrados en Optimydent sin justificante vinculado. Solo es útil si has leído las facturas de PICADAS de ese trimestre.</CardDescription>
        </CardHeader>
        <CardContent>
          {missing.data!.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todos los gastos del trimestre tienen su justificante vinculado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Nº factura</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missing.data!.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.issue_date)}</TableCell>
                    <TableCell>{m.issuer_name}</TableCell>
                    <TableCell>{m.invoice_number}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(m.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-montserrat">Ficheros con error</CardTitle>
            <CardDescription>Puedes volver a seleccionarlos y leerlos.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {errors.map((e) => (
                <li key={e.path}>
                  <span className="font-medium">{e.path}</span> — <span className="text-muted-foreground">{e.error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
