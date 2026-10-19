import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { quarterLabel, quarterParam, recentQuarters, type Quarter } from "@/lib/periods";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-montserrat text-xl font-semibold text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, hint, accent = false }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("font-montserrat text-2xl font-semibold", accent ? "text-primary" : "text-foreground")}>{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export type EffectiveStatus = "pagada" | "parcial" | "pendiente" | "atrasada" | "anulada";

/** "Atrasada" no se guarda: pendiente/parcial con vencimiento pasado. */
export function effectiveStatus(status: string, dueDate: string | null, today: string): EffectiveStatus {
  if ((status === "pendiente" || status === "parcial") && dueDate && dueDate < today) return "atrasada";
  return status as EffectiveStatus;
}

const STATUS: Record<EffectiveStatus, { label: string; className: string }> = {
  pagada: { label: "Pagado", className: "bg-success/15 text-success" },
  parcial: { label: "Parcial", className: "bg-warning/15 text-warning" },
  pendiente: { label: "Pendiente", className: "bg-warning/15 text-warning" },
  atrasada: { label: "Atrasado", className: "bg-destructive/10 text-destructive" },
  anulada: { label: "Anulada", className: "bg-muted text-muted-foreground line-through" },
};

export function StatusBadge({ status }: { status: EffectiveStatus }) {
  const s = STATUS[status] ?? STATUS.pendiente;
  return <Badge className={s.className}>{s.label}</Badge>;
}

/** Selector de trimestre por enlaces (sin JS): ?t=2026-3 */
export function QuarterTabs({ basePath, current, extra = "" }: { basePath: string; current: Quarter; extra?: string }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {recentQuarters(6)
        .reverse()
        .map((q) => {
          const active = q.year === current.year && q.quarter === current.quarter;
          return (
            <Link
              key={quarterParam(q)}
              href={`${basePath}?t=${quarterParam(q)}${extra}`}
              className={cn(
                "rounded-md px-3 py-1 font-montserrat text-xs font-medium transition-colors",
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {quarterLabel(q)}
            </Link>
          );
        })}
    </div>
  );
}

export const REVIEW_REASONS: Record<string, string> = {
  tipo_gasto_nuevo: "Tipo de gasto nuevo",
  tipo_gasto_sin_cuenta: "Tipo sin cuenta contable",
  sin_numero: "Sin nº de factura",
  numero_factura_repetido: "Nº de factura repetido en otra factura (se mantienen ambas)",
  sin_nif: "Sin NIF",
  nif_emisor_es_la_clinica: "CIF del proveedor = el de la clínica",
  linea_repetida_en_origen: "Línea repetida en Optimydent",
  tipos_distintos_en_factura: "Varios tipos de gasto",
  iva_no_cuadra: "IVA no cuadra con el tipo",
  ia_baja_confianza: "Lectura IA dudosa",
  ia_no_cuadra: "Los importes leídos no cuadran",
  sin_fecha: "Sin fecha",
  lectura_incompleta: "Lectura incompleta",
  no_es_factura: "No es una factura",
  emisor_no_es_la_clinica: "Emitida pero el emisor no es la clínica",
  no_dirigida_a_la_clinica: "El destinatario no es la clínica",
  profesional_sin_retencion: "Doctora sin retención",
  picada_sin_registro: "En PICADAS pero no aparece en Optimydent",
  no_registrada_optimydent: "Aún no está en Optimydent",
};

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>
  );
}
