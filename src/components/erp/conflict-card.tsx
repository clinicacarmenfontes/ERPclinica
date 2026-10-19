"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveConflict } from "@/app/dashboard/sincronizacion/actions";
import { formatCurrency, formatDate } from "@/lib/format";

const FIELD_LABELS: Record<string, string> = {
  issue_date: "Fecha",
  issuer_name: "Emisor",
  base_total: "Base",
  vat_total: "IVA",
  withholding_total: "Retención",
  total: "Total",
};

const DONE = {
  mantener_existente: "Se mantiene la factura existente",
  sustituir_por_entrante: "Factura sustituida",
  mantener_ambas: "Se mantienen las dos facturas, marcadas para revisar el nº",
};

function show(field: string, value: unknown) {
  if (value === null || value === undefined) return "—";
  if (field === "issue_date") return formatDate(String(value));
  if (field === "issuer_name") return String(value);
  return formatCurrency(Number(value));
}

export function ConflictCard({
  conflict,
}: {
  conflict: {
    id: string;
    created_at: string;
    differences: Record<string, [unknown, unknown]>;
    invoice: { invoice_number: string; issuer_name: string; issue_date: string; total: number } | null;
  };
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function resolve(resolution: "mantener_existente" | "sustituir_por_entrante" | "mantener_ambas") {
    startTransition(async () => {
      const r = await resolveConflict(conflict.id, resolution, note);
      if (r.ok) toast.success(DONE[resolution]);
      else toast.error(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="font-medium">
          {conflict.invoice?.issuer_name} · {conflict.invoice?.invoice_number}
        </p>
        <p className="text-xs text-muted-foreground">
          Ya existe una factura con este emisor, número y año, pero el dato entrante es distinto. Si son dos facturas
          distintas (p. ej. un nº repetido por error), mantén ambas: quedarán marcadas para revisar.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="font-normal">Campo</th>
            <th className="font-normal">Existente</th>
            <th className="font-normal">Entrante</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(conflict.differences).map(([field, [before, after]]) => (
            <tr key={field}>
              <td className="py-0.5 text-muted-foreground">{FIELD_LABELS[field] ?? field}</td>
              <td className="py-0.5 tabular-nums">{show(field, before)}</td>
              <td className="py-0.5 font-medium tabular-nums">{show(field, after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Textarea
        placeholder="Motivo (obligatorio para sustituir): p. ej. «el proveedor reutiliza el nº cada mes; la entrante es la de agosto»"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={() => resolve("mantener_existente")}>
          Mantener la existente
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => resolve("mantener_ambas")}>
          Mantener ambas
        </Button>
        <Button size="sm" disabled={pending} onClick={() => resolve("sustituir_por_entrante")}>
          Sustituir por la entrante
        </Button>
      </div>
    </div>
  );
}
