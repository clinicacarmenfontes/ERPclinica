"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { closeQuarter, reopenQuarter } from "@/app/dashboard/fiscal/actions";

/** Cerrar (tras entregar al gestor) o reabrir con motivo un trimestre. */
export function QuarterClose({
  year,
  quarter,
  closed,
  pendingIssues,
}: {
  year: number;
  quarter: number;
  closed: boolean;
  pendingIssues: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const label = `${quarter}T ${year}`;

  function submit() {
    startTransition(async () => {
      const r = closed ? await reopenQuarter(year, quarter, reason) : await closeQuarter(year, quarter);
      if (r.ok) {
        toast.success(closed ? `${label} reabierto` : `${label} cerrado`);
        setOpen(false);
        setReason("");
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <>
      <Button variant={closed ? "outline" : "default"} onClick={() => setOpen(true)}>
        {closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
        {closed ? "Reabrir trimestre" : "Cerrar trimestre"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closed ? `Reabrir ${label}` : `Cerrar ${label}`}</DialogTitle>
            <DialogDescription>
              {closed
                ? "Volverán a admitirse altas y reclasificaciones en el trimestre. Queda registrado con el motivo."
                : "Ciérralo cuando hayas entregado los datos al gestor: no se podrán dar de alta ni reclasificar facturas del trimestre (los cobros y pagos posteriores sí). Se puede reabrir con motivo."}
            </DialogDescription>
          </DialogHeader>
          {!closed && pendingIssues > 0 && (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Quedan {pendingIssues} asunto(s) por revisar en este trimestre. Puedes cerrarlo igualmente, pero conviene
              resolverlos antes.
            </p>
          )}
          {closed && (
            <Textarea
              placeholder="Motivo (obligatorio, mín. 10 caracteres): p. ej. «llegó una factura de septiembre tarde»"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={pending} onClick={submit}>
              {closed ? "Reabrir" : "Cerrar trimestre"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
