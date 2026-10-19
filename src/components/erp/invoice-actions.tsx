"use client";

import { useCallback, useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { markInvoiceReviewed, voidInvoice } from "@/app/dashboard/invoice-actions";
import { InvoiceEditDialog } from "@/components/erp/invoice-edit-dialog";
import { formatCurrency, formatDate } from "@/lib/format";

type Mode = "revisar" | "anular" | null;

const TITLES: Record<Exclude<Mode, null>, string> = {
  revisar: "Dar por revisada",
  anular: "Anular factura",
};

const DESCRIPTIONS: Record<Exclude<Mode, null>, string> = {
  revisar: "Quita la marca de revisión. La factura no cambia.",
  anular:
    "La factura entera deja de contar. Si Optimydent vuelve a mandar este mismo dato, se ignorará. Si solo sobra una línea repetida, usa «Corregir datos» y quita esa línea.",
};

/** Menú de acciones de una factura viva: corregir datos, revisar, anular. */
export function InvoiceActions({
  invoice,
}: {
  invoice: { id: string; invoice_number: string; issue_date: string; party: string; total: number; needs_review: boolean };
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const closeEdit = useCallback(() => setEditing(false), []);

  function open(next: Exclude<Mode, null>) {
    setReason("");
    setMode(next);
  }

  function submit() {
    startTransition(async () => {
      const r = mode === "revisar" ? await markInvoiceReviewed(invoice.id, reason) : await voidInvoice(invoice.id, reason);
      if (r.ok) {
        toast.success(mode === "revisar" ? "Factura revisada" : "Factura anulada");
        setMode(null);
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Acciones de la factura">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Corregir datos</DropdownMenuItem>
          {invoice.needs_review && <DropdownMenuItem onSelect={() => open("revisar")}>Dar por revisada</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onSelect={() => open("anular")}>
            Anular
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editing && <InvoiceEditDialog invoiceId={invoice.id} open={editing} onClose={closeEdit} />}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        {mode && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{TITLES[mode]}</DialogTitle>
              <DialogDescription>
                {invoice.party} · {invoice.invoice_number} · {formatDate(invoice.issue_date)} ·{" "}
                {formatCurrency(invoice.total)}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{DESCRIPTIONS[mode]}</p>
            <Textarea
              placeholder={
                mode === "revisar"
                  ? "Nota (opcional): p. ej. «comprobado con el proveedor: son dos facturas distintas»"
                  : "Motivo (obligatorio, mín. 10 caracteres)"
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setMode(null)}>
                Cancelar
              </Button>
              <Button variant={mode === "anular" ? "destructive" : "default"} disabled={pending} onClick={submit}>
                {TITLES[mode]}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
