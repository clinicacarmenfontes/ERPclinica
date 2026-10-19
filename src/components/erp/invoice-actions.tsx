"use client";

import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { correctInvoiceIdentity, markInvoiceReviewed, voidInvoice } from "@/app/dashboard/invoice-actions";
import { formatCurrency, formatDate } from "@/lib/format";

type Mode = "revisar" | "corregir" | "anular" | null;

const TITLES: Record<Exclude<Mode, null>, string> = {
  revisar: "Dar por revisada",
  corregir: "Corregir nº o fecha",
  anular: "Anular factura",
};

const DESCRIPTIONS: Record<Exclude<Mode, null>, string> = {
  revisar: "Quita la marca de revisión. La factura no cambia.",
  corregir:
    "La factura actual se anula y se crea la correcta enlazada, con los mismos importes, líneas y tipo de gasto. Si estaba contabilizada, se rectifica su asiento. Corrígelo también en Optimydent.",
  anular:
    "La factura deja de contar. Si Optimydent vuelve a mandar este mismo dato, se ignorará. Si estaba contabilizada, se rectifica su asiento.",
};

/** Menú de acciones de una factura viva: revisar, corregir nº/fecha, anular. */
export function InvoiceActions({
  invoice,
}: {
  invoice: { id: string; invoice_number: string; issue_date: string; party: string; total: number; needs_review: boolean };
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [number, setNumber] = useState(invoice.invoice_number);
  const [date, setDate] = useState(invoice.issue_date);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function open(next: Exclude<Mode, null>) {
    setNumber(invoice.invoice_number);
    setDate(invoice.issue_date);
    setReason("");
    setMode(next);
  }

  function submit() {
    startTransition(async () => {
      const r =
        mode === "revisar"
          ? await markInvoiceReviewed(invoice.id, reason)
          : mode === "corregir"
            ? await correctInvoiceIdentity(invoice.id, { invoiceNumber: number, issueDate: date, reason })
            : await voidInvoice(invoice.id, reason);
      if (r.ok) {
        toast.success(mode === "revisar" ? "Factura revisada" : mode === "corregir" ? "Factura corregida" : "Factura anulada");
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
          {invoice.needs_review && <DropdownMenuItem onSelect={() => open("revisar")}>Dar por revisada</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => open("corregir")}>Corregir nº o fecha</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => open("anular")}>
            Anular
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
            {mode === "corregir" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`num-${invoice.id}`} className="text-xs text-muted-foreground">
                    Nº de factura
                  </Label>
                  <Input id={`num-${invoice.id}`} value={number} onChange={(e) => setNumber(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`date-${invoice.id}`} className="text-xs text-muted-foreground">
                    Fecha
                  </Label>
                  <Input id={`date-${invoice.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
            )}
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
