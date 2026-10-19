"use client";

import { useState, useTransition } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateGestorExcelAction } from "@/app/dashboard/fiscal/actions";

/** Genera la versión siguiente del Excel del gestor y la descarga. */
export function GenerateGestorButton({
  year,
  quarter,
  nextVersion,
  blocked,
}: {
  year: number;
  quarter: number;
  nextVersion: number;
  blocked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [details, setDetails] = useState<string[] | null>(null);

  function generate() {
    setDetails(null);
    startTransition(async () => {
      const r = await generateGestorExcelAction(year, quarter);
      if (r.ok) {
        toast.success(`${r.fileName} generado y verificado`);
        const link = document.createElement("a");
        link.href = `/api/gestor/${r.id}`;
        link.click();
      } else {
        toast.error(r.message);
        setDetails(r.details ?? null);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={generate} disabled={pending || blocked}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
        {pending ? "Generando y verificando…" : `Generar Excel v${nextVersion}`}
      </Button>
      {blocked && <p className="text-xs text-destructive">Resuelve los controles en rojo para poder generarlo.</p>}
      {details && (
        <ul className="max-w-md list-disc pl-5 text-xs text-destructive">
          {details.slice(0, 10).map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
