"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setVatProrrata } from "@/app/dashboard/configuracion/actions";

export function ProrrataEditor({ value }: { value: number }) {
  const [pct, setPct] = useState(String(value));
  const [pending, startTransition] = useTransition();
  const changed = Number(pct.replace(",", ".")) !== value;

  function save() {
    startTransition(async () => {
      const r = await setVatProrrata(Number(pct.replace(",", ".")));
      if (r.ok) toast.success("Prorrata actualizada");
      else toast.error(r.message);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label="Prorrata de IVA en %"
        inputMode="decimal"
        value={pct}
        onChange={(e) => setPct(e.target.value)}
        className="h-8 w-20 text-right"
      />
      <span className="text-sm">%</span>
      {changed && (
        <Button size="sm" disabled={pending} onClick={save}>
          Guardar
        </Button>
      )}
    </div>
  );
}
