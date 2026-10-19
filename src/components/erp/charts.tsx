"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { formatCurrency } from "@/lib/format";

// Gráficas del Resumen. Colores: tokens --series-* (validados para daltonismo
// y contraste en claro y oscuro). Textos siempre en tokens de texto.

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };

/** 12500 → "12,5 k€" · 800 → "800 €" (ejes). */
function compactEur(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(n)} €`;
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: number; color?: string; strong?: boolean }[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {r.color && <span className="size-2 rounded-sm" style={{ backgroundColor: r.color }} />}
            {r.label}
          </span>
          <span className={r.strong ? "font-semibold text-foreground tabular-nums" : "text-foreground tabular-nums"}>
            {formatCurrency(r.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── Ingresos vs Gastos por mes ─────────────────────────────────────────────

export type MonthPoint = { month: string; label: string; income: number; expense: number };

const INCOME = "var(--series-income)";
const EXPENSE = "var(--series-expense)";

function MonthTooltip({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as MonthPoint;
  return (
    <TooltipBox
      title={p.month}
      rows={[
        { label: "Ingresos", value: p.income, color: INCOME },
        { label: "Gastos", value: p.expense, color: EXPENSE },
        { label: "Resultado", value: p.income - p.expense, strong: true },
      ]}
    />
  );
}

export function IncomeExpenseChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="flex flex-col gap-3">
      <Legend
        items={[
          { label: "Ingresos", color: INCOME },
          { label: "Gastos", color: EXPENSE },
        ]}
      />
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={AXIS_TICK} />
            <YAxis tickFormatter={compactEur} tickLine={false} axisLine={false} tick={AXIS_TICK} width={64} />
            <Tooltip content={MonthTooltip} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            <Bar dataKey="income" name="Ingresos" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="expense" name="Gastos" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Ver como tabla</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-normal">Mes</th>
              <th className="text-right font-normal">Ingresos</th>
              <th className="text-right font-normal">Gastos</th>
              <th className="text-right font-normal">Resultado</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.month}>
                <td>{d.month}</td>
                <td className="text-right">{formatCurrency(d.income)}</td>
                <td className="text-right">{formatCurrency(d.expense)}</td>
                <td className="text-right font-medium">{formatCurrency(d.income - d.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ── Cashflow proyectado ───────────────────────────────────────────────────

export type CashPoint = { label: string; range: string; inflow: number; outflow: number; balance: number };

const BALANCE = "var(--primary)";

function CashTooltip({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as CashPoint;
  return (
    <TooltipBox
      title={p.range}
      rows={[
        { label: "Cobros previstos", value: p.inflow },
        { label: "Pagos previstos", value: -p.outflow },
        { label: "Saldo previsto", value: p.balance, strong: true },
      ]}
    />
  );
}

export function CashflowChart({ data }: { data: CashPoint[] }) {
  const min = Math.min(0, ...data.map((d) => d.balance));
  return (
    <div className="flex flex-col gap-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={AXIS_TICK} interval="preserveStartEnd" />
            <YAxis tickFormatter={compactEur} tickLine={false} axisLine={false} tick={AXIS_TICK} width={64} domain={[min, "auto"]} />
            {min < 0 && <ReferenceLine y={0} stroke="var(--destructive)" strokeWidth={1} />}
            <Tooltip content={CashTooltip} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={BALANCE}
              strokeWidth={2}
              fill={BALANCE}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Ver como tabla</summary>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-normal">Semana</th>
              <th className="text-right font-normal">Cobros</th>
              <th className="text-right font-normal">Pagos</th>
              <th className="text-right font-normal">Saldo previsto</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.range}>
                <td>{d.range}</td>
                <td className="text-right">{formatCurrency(d.inflow)}</td>
                <td className="text-right">{formatCurrency(-d.outflow)}</td>
                <td className="text-right font-medium">{formatCurrency(d.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
