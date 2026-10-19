"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { savePayrollMonth } from "@/app/dashboard/nominas/actions";
import { PAYROLL_FIELDS as FIELDS, type PayrollInput } from "@/lib/payroll";

const toText = (n: number | null | undefined) => (n ? String(n).replace(".", ",") : "");
/** "1.234,56" · "1234,56" · "1234.56" → 1234.56 (el punto es decimal solo si no hay coma y lleva 1-2 decimales). */
function toNumber(s: string): number {
  const t = s.trim().replace(/\s|€/g, "");
  if (t === "") return 0;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return /^\d+\.\d{1,2}$/.test(t) ? Number(t) : Number(t.replace(/\./g, ""));
}

/** Una fila editable por mes: el resumen de nóminas que pasa el gestor. */
export function PayrollRow({ period, label, initial, locked }: { period: string; label: string; initial: PayrollInput | null; locked: boolean }) {
  const [values, setValues] = useState<Record<keyof PayrollInput, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, toText(initial?.[f.key])])) as Record<keyof PayrollInput, string>,
  );
  const [saved, setSaved] = useState(values);
  const [pending, startTransition] = useTransition();
  const changed = FIELDS.some((f) => values[f.key] !== saved[f.key]);
  const invalid = FIELDS.some((f) => Number.isNaN(toNumber(values[f.key])));

  function save() {
    startTransition(async () => {
      const r = await savePayrollMonth(
        period,
        Object.fromEntries(FIELDS.map((f) => [f.key, toNumber(values[f.key])])) as PayrollInput,
      );
      if (r.ok) {
        toast.success(`Nóminas de ${label} guardadas`);
        setSaved(values);
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium whitespace-nowrap capitalize">{label}</TableCell>
      {FIELDS.map((f) => (
        <TableCell key={f.key}>
          <Input
            aria-label={`${f.label} de ${label}`}
            inputMode="decimal"
            value={values[f.key]}
            disabled={locked || pending}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className="h-8 w-28 text-right tabular-nums"
            placeholder="0"
          />
        </TableCell>
      ))}
      <TableCell className="w-24 text-right">
        {locked ? (
          <span className="text-xs text-muted-foreground">Trimestre cerrado</span>
        ) : (
          changed && (
            <Button size="sm" disabled={pending || invalid} onClick={save}>
              Guardar
            </Button>
          )
        )}
      </TableCell>
    </TableRow>
  );
}
