import Link from "next/link";
import { AlertTriangle, Stethoscope } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { share, type ProfitAndLoss } from "@/lib/finance";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

// Panel de rentabilidad del Resumen (componente de servidor: solo pinta).

const pctText = (part: number, total: number) => {
  const p = share(part, total);
  return p === null ? "—" : `${p.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
};

type Line = { label: string; key: keyof ProfitAndLoss; sign?: "−" | "="; strong?: boolean; indent?: boolean; muted?: boolean };

const LINES: Line[] = [
  { label: "Ingresos", key: "ingresos", strong: true },
  { label: "Clínica (pacientes)", key: "ingresosClinica", indent: true },
  { label: "Carmen Fontes en otras clínicas", key: "ingresosOtrasClinicas", indent: true },
  { label: "Coste directo (material y laboratorio)", key: "costeDirecto", sign: "−" },
  { label: "Margen bruto", key: "margenBruto", sign: "=", strong: true },
  { label: "Estructura (local, suministros, marketing, software…)", key: "estructura", sign: "−" },
  { label: "Doctoras con retención", key: "personalDoctoras", sign: "−" },
  { label: "Nóminas y SS empresa", key: "nominas", sign: "−" },
  { label: "EBITDA antes de la retribución de la socia", key: "ebitdaAntesSocia", sign: "=", strong: true },
  { label: "Retribución de la socia", key: "socia", sign: "−" },
  { label: "EBITDA", key: "ebitda", sign: "=", strong: true },
  { label: "Financiero e impuestos (fuera del EBITDA)", key: "financiero", muted: true },
];

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function FinancePanel({
  quarter,
  year,
  quarterLabel,
  yearLabel,
  currentMonth,
}: {
  quarter: ProfitAndLoss;
  year: ProfitAndLoss;
  quarterLabel: string;
  yearLabel: string;
  /** 'AAAA-MM' del mes en curso: aún no tiene nóminas y no se avisa. */
  currentMonth: string;
}) {
  const missing = year.mesesSinNominas.filter((m) => m !== currentMonth);
  const maxPartida = Math.max(1, ...year.porPartida.map((p) => p.amount));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="font-montserrat">Rentabilidad · cuenta de resultados</CardTitle>
          <CardDescription>
            Estimación de gestión con las facturas y nóminas cargadas, en base imponible (sin IVA). Sin amortizaciones.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {missing.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Faltan las nóminas de {missing.map((m) => MONTHS[Number(m.slice(5, 7)) - 1]).join(", ")}: el margen y el
                EBITDA salen más altos de lo real.{" "}
                <Link href="/dashboard/nominas" className="underline">
                  Cárgalas en Nóminas
                </Link>
                .
              </span>
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-normal" />
                  <th className="py-1 text-right font-normal">{quarterLabel}</th>
                  <th className="py-1 text-right font-normal">%</th>
                  <th className="py-1 text-right font-normal">{yearLabel}</th>
                  <th className="py-1 text-right font-normal">%</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {LINES.map((l) => (
                  <tr
                    key={l.key}
                    className={cn(
                      l.strong && "border-t border-border font-semibold",
                      l.muted && "text-muted-foreground",
                    )}
                  >
                    <td className={cn("py-1.5", l.indent && "pl-5 text-muted-foreground")}>
                      {l.sign && <span className="mr-1.5 inline-block w-3 text-muted-foreground">{l.sign}</span>}
                      {l.label}
                    </td>
                    {[quarter, year].map((p, i) => (
                      <FragmentCells key={i} value={p[l.key] as number} total={p.ingresos} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {year.sinPartida > 0 && (
            <p className="text-xs text-muted-foreground">
              Incluye {formatCurrency(year.sinPartida)} de gastos sin partida (tipo de gasto sin clasificar) dentro de
              Estructura.{" "}
              <Link href="/dashboard/configuracion#tipos" className="text-primary underline">
                Asígnales partida
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Carmen Fontes</CardTitle>
          <CardDescription>{yearLabel}: lo que percibe y lo que factura fuera, sobre los ingresos de la clínica.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Retribución como socia</p>
            <p className="font-montserrat text-3xl font-semibold text-primary">{formatCurrency(year.socia, { compact: true })}</p>
            <p className="text-sm text-muted-foreground">
              {year.socia ? `${pctText(year.socia, year.ingresos)} de los ingresos` : "Aún sin cargar en Nóminas"}
              {quarter.socia ? ` · ${quarterLabel}: ${formatCurrency(quarter.socia, { compact: true })} (${pctText(quarter.socia, quarter.ingresos)})` : ""}
            </p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Facturación en otras clínicas</p>
            <p className="font-montserrat text-xl font-semibold">{formatCurrency(year.ingresosOtrasClinicas, { compact: true })}</p>
            <p className="text-sm text-muted-foreground">{pctText(year.ingresosOtrasClinicas, year.ingresos)} de los ingresos totales</p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Producción en la clínica</p>
            <p className="text-sm text-muted-foreground">
              Pendiente: hace falta el listado de tratamientos de Optimydent con el doctor de cada tratamiento.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="font-montserrat">Gastos por partida · {yearLabel}</CardTitle>
          <CardDescription>Base imponible e importe sobre los ingresos. Incluye nóminas y retribución de la socia.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {year.porPartida.length === 0 && <p className="text-muted-foreground">Sin gastos cargados.</p>}
          {year.porPartida.map((p) => (
            <div key={p.name} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3">
              <span className="truncate" title={p.name}>
                {p.name}
              </span>
              <div className="h-4 rounded-r bg-muted/40">
                <div
                  className="h-4 rounded-r-[4px] bg-[var(--series-expense)]"
                  style={{ width: `${Math.max(1, (p.amount / maxPartida) * 100)}%` }}
                />
              </div>
              <span className="w-40 text-right tabular-nums">
                {formatCurrency(p.amount, { compact: true })} <span className="text-muted-foreground">· {pctText(p.amount, year.ingresos)}</span>
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-montserrat">
            <Stethoscope className="size-4 text-muted-foreground" /> Facturación por tratamiento
          </CardTitle>
          <CardDescription>Por especialidad y por doctor.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Pendiente del listado de tratamientos de Optimydent (tratamiento, importe y doctor). Cuando se cargue, aquí verás
          la facturación por especialidad (conservadora, ortodoncia, implantes, prótesis, periodoncia, estética…) y la
          producción de cada doctora.
        </CardContent>
      </Card>
    </div>
  );
}

function FragmentCells({ value, total }: { value: number; total: number }) {
  return (
    <>
      <td className="py-1.5 text-right">{formatCurrency(value, { compact: true })}</td>
      <td className="py-1.5 pl-3 text-right text-xs text-muted-foreground">{pctText(value, total)}</td>
    </>
  );
}
