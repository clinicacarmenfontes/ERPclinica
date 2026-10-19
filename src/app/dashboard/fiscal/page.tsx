import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard, PageHeader, QuarterTabs } from "@/components/erp/common";
import { QuarterClose } from "@/components/erp/quarter-close";
import { requireAdminPage } from "@/lib/auth/session";
import { compute303, type VatRow } from "@/lib/fiscal";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { parseQuarterParam, quarterLabel, quarterRange } from "@/lib/periods";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Fiscal | ERP Clínica Carmen Fontes" };

type Withholding = { model: string; counterparty_id: string; invoices: number; base: number; withholding: number };
type Payroll = { period: string; gross_salaries: number; worker_withholding: number };
type Row347 = { direction: string; party_id: string; tax_id: string | null; name: string; annual_amount: number; q1: number | null; q2: number | null; q3: number | null; q4: number | null };
type PeriodEvent = { action: string; reason: string | null; actor: string; created_at: string };

const pct = (rate: number) => `${Math.round(Number(rate) * 10000) / 100} %`;
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + Number(x) * 100, 0)) / 100;

export default async function FiscalPage(props: PageProps<"/dashboard/fiscal">) {
  await requireAdminPage();
  const q = parseQuarterParam((await props.searchParams).t);
  const { from, to } = quarterRange(q);
  const months = [0, 1, 2].map((i) => `${q.year}-${String((q.quarter - 1) * 3 + 1 + i).padStart(2, "0")}`);
  const db = createAdminClient();

  const [vat, settings, wh, payroll, m347, period, events, review] = await Promise.all([
    db.from("v_vat_by_quarter").select("direction, vat_rate, exempt, base, vat").eq("year", q.year).eq("quarter", q.quarter).returns<VatRow[]>(),
    db.from("company_settings").select("vat_prorrata_pct").single<{ vat_prorrata_pct: number }>(),
    db
      .from("v_withholding_by_quarter")
      .select("model, counterparty_id, invoices, base, withholding")
      .eq("year", q.year)
      .eq("quarter", q.quarter)
      .returns<Withholding[]>(),
    db.from("payroll_months").select("period, gross_salaries, worker_withholding").in("period", months).returns<Payroll[]>(),
    db
      .from("v_model_347_draft")
      .select("direction, party_id, tax_id, name, annual_amount, q1, q2, q3, q4")
      .eq("year", q.year)
      .order("annual_amount", { ascending: false })
      .returns<Row347[]>(),
    db.from("tax_periods").select("status, closed_at, closed_by").eq("year", q.year).eq("quarter", q.quarter).maybeSingle(),
    db
      .from("tax_period_events")
      .select("action, reason, actor, created_at")
      .eq("year", q.year)
      .eq("quarter", q.quarter)
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<PeriodEvent[]>(),
    db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("needs_review", true)
      .neq("status", "anulada")
      .gte("issue_date", from)
      .lte("issue_date", to),
  ]);
  for (const r of [vat, settings, wh, payroll, m347, period, events, review]) if (r.error) throw r.error;

  const prorrata = Number(settings.data!.vat_prorrata_pct);
  const m303 = compute303(vat.data!, prorrata);
  const closed = period.data?.status === "cerrado";

  const partyIds = [...new Set(wh.data!.map((w) => w.counterparty_id))];
  const parties = partyIds.length
    ? await db.from("parties").select("id, name, tax_id").in("id", partyIds).returns<{ id: string; name: string; tax_id: string | null }[]>()
    : { data: [], error: null };
  if (parties.error) throw parties.error;
  const partyOf = (id: string) => parties.data!.find((p) => p.id === id);

  const w111 = wh.data!.filter((w) => w.model === "111");
  const w115 = wh.data!.filter((w) => w.model === "115");
  const missingPayroll = months.filter((m) => !payroll.data!.some((p) => p.period === m));
  const workers = sum(payroll.data!.map((p) => p.worker_withholding));
  const total111 = sum([...w111.map((w) => w.withholding), workers]);
  const total115 = sum(w115.map((w) => w.withholding));

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Fiscal"
        description="Borradores de los modelos trimestrales con lo cargado en el ERP. Son orientativos: el gestor los valida y presenta."
      >
        <QuarterTabs basePath="/dashboard/fiscal" current={q} />
      </PageHeader>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 font-montserrat font-semibold">
              {quarterLabel(q)}
              <Badge className={closed ? "bg-muted text-muted-foreground" : "bg-success/15 text-success"}>{closed ? "Cerrado" : "Abierto"}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">
              {closed
                ? `Cerrado el ${formatDateTime(period.data!.closed_at)} por ${period.data!.closed_by}.`
                : "Admite altas y reclasificaciones. Ciérralo al entregar los datos al gestor."}
              {(review.count ?? 0) > 0 && (
                <>
                  {" "}
                  <Link href="/dashboard/revision" className="text-primary underline">
                    {review.count} factura(s) del trimestre por revisar
                  </Link>
                  .
                </>
              )}
            </p>
            {events.data!.length > 0 && (
              <ul className="mt-1 text-xs text-muted-foreground">
                {events.data!.map((e, i) => (
                  <li key={i}>
                    {formatDateTime(e.created_at)} · {e.action} por {e.actor}
                    {e.reason ? ` · «${e.reason}»` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <QuarterClose year={q.year} quarter={q.quarter} closed={closed} pendingIssues={review.count ?? 0} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Modelo 303 · resultado"
          value={formatCurrency(m303.resultado)}
          hint={m303.resultado >= 0 ? "A ingresar" : "A compensar / devolver"}
          accent
        />
        <KpiCard label="Modelo 111 · retenciones" value={formatCurrency(total111)} hint="Profesionales y trabajadores" />
        <KpiCard label="Modelo 115 · alquileres" value={formatCurrency(total115)} hint="Retenciones de arrendamientos" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Modelo 303 · IVA</CardTitle>
          <CardDescription>
            Facturas emitidas y recibidas del trimestre (no anuladas). Prorrata aplicada: {prorrata} %
            {prorrata === 0 && " — pendiente de fijar con el gestor en Configuración; mientras, no se deduce IVA soportado"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">IVA devengado (emitidas)</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Cuota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {m303.devengado.map((b) => (
                  <TableRow key={b.rate}>
                    <TableCell>{pct(b.rate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.base)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.vat)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-muted-foreground">Exentas (art. 20 LIVA)</TableCell>
                  <TableCell className="text-right">{formatCurrency(m303.exentas)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                </TableRow>
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total devengado</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(m303.totalDevengado)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">IVA soportado (recibidas)</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Cuota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {m303.soportado.map((b) => (
                  <TableRow key={b.rate}>
                    <TableCell>{pct(b.rate)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.base)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(b.vat)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-muted-foreground">Sin IVA / exento</TableCell>
                  <TableCell className="text-right">{formatCurrency(m303.soportadoExento)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">—</TableCell>
                </TableRow>
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total soportado</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(m303.totalSoportado)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={2}>Deducible ({prorrata} %)</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(m303.deducible)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <div className="flex items-baseline justify-between rounded-lg bg-muted p-4 lg:col-span-2">
            <span className="text-sm">Resultado: devengado − deducible</span>
            <span className="font-montserrat text-xl font-semibold tabular-nums">{formatCurrency(m303.resultado)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-montserrat">Modelo 111 · retenciones IRPF</CardTitle>
            <CardDescription>Profesionales (facturas con retención) y trabajadores (nóminas del gestor).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Perceptor</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Retención</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {w111.map((w) => (
                  <TableRow key={w.counterparty_id}>
                    <TableCell>
                      {partyOf(w.counterparty_id)?.name ?? "—"}
                      <span className="block text-xs text-muted-foreground">{partyOf(w.counterparty_id)?.tax_id ?? "sin NIF"}</span>
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(w.base)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(w.withholding)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell>
                    Trabajadores (nóminas)
                    <span className="block text-xs text-muted-foreground">{payroll.data!.length} de 3 meses cargados</span>
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(sum(payroll.data!.map((p) => p.gross_salaries)))}</TableCell>
                  <TableCell className="text-right">{formatCurrency(workers)}</TableCell>
                </TableRow>
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total a ingresar</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(total111)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            {missingPayroll.length > 0 && (
              <p className="text-xs text-warning">
                Faltan las nóminas de {missingPayroll.join(", ")}: el importe de trabajadores está incompleto.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-montserrat">Modelo 115 · alquileres</CardTitle>
            <CardDescription>Retenciones practicadas en facturas de arrendamiento.</CardDescription>
          </CardHeader>
          <CardContent>
            {w115.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin facturas de alquiler con retención en {quarterLabel(q)}.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arrendador</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">Retención</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {w115.map((w) => (
                    <TableRow key={w.counterparty_id}>
                      <TableCell>{partyOf(w.counterparty_id)?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatCurrency(w.base)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(w.withholding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2}>Total a ingresar</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(total115)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Modelo 347 · borrador {q.year}</CardTitle>
          <CardDescription>
            Terceros con más de 3.005,06 € en el año (sin las operaciones con retención, que van en 190/180). Criterios a
            validar con el gestor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {m347.data!.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ningún tercero supera el umbral con lo cargado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tercero</TableHead>
                  <TableHead>Tipo</TableHead>
                  {[1, 2, 3, 4].map((n) => (
                    <TableHead key={n} className="text-right">
                      {n}T
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Año</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {m347.data!.map((r) => (
                  <TableRow key={`${r.direction}-${r.party_id}`}>
                    <TableCell>
                      {r.name}
                      <span className="block text-xs text-muted-foreground">{r.tax_id ?? "sin NIF"}</span>
                    </TableCell>
                    <TableCell className="text-sm">{r.direction === "emitida" ? "Ventas" : "Compras"}</TableCell>
                    {[r.q1, r.q2, r.q3, r.q4].map((v, i) => (
                      <TableCell key={i} className="text-right">
                        {v ? formatCurrency(v) : "—"}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">{formatCurrency(r.annual_amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
