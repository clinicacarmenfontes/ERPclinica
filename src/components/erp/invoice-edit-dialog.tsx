"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { editInvoice, getInvoiceForEdit, type InvoiceEdit, type InvoiceForEdit } from "@/app/dashboard/invoice-actions";
import { REVIEW_REASONS } from "@/components/erp/common";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

const SELECT =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

// Qué campo corrige cada aviso (se resalta en el diálogo).
const FIELD_OF: Record<string, "number" | "nif" | "type" | "lines"> = {
  sin_numero: "number",
  numero_factura_repetido: "number",
  sin_nif: "nif",
  nif_emisor_es_la_clinica: "nif",
  tipo_gasto_nuevo: "type",
  tipo_gasto_sin_cuenta: "type",
  tipos_distintos_en_factura: "type",
  linea_repetida_en_origen: "lines",
};

const cents = (n: number) => Math.round(n * 100);

function Field({ label, flagged, hint, children }: { label: string; flagged: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg", flagged && "bg-warning/10 p-2 ring-1 ring-warning/40")}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {flagged && <span className="ml-1 font-medium text-warning">· tiene un aviso</span>}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Corregir los datos de una factura: los campos con aviso salen resaltados. */
export function InvoiceEditDialog({ invoiceId, open, onClose }: { invoiceId: string; open: boolean; onClose: () => void }) {
  const [inv, setInv] = useState<InvoiceForEdit | null>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [nif, setNif] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [remove, setRemove] = useState<number[]>([]);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getInvoiceForEdit(invoiceId).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        toast.error(r.message);
        onClose();
        return;
      }
      const i = r.invoice;
      setInv(i);
      setNumber(i.invoice_number);
      setDate(i.issue_date);
      setNif((i.direction === "recibida" ? i.issuer_tax_id : i.counterparty?.tax_id) ?? "");
      setName(i.counterparty?.name ?? "");
      setType(i.expense_type_id ?? "");
      setRemove([]);
      setReason("");
    });
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId, onClose]);

  const flagged = new Set((inv?.review_reasons ?? []).map((r) => FIELD_OF[r]).filter(Boolean));
  const income = inv?.direction === "emitida";

  // Solo se mandan los campos cambiados.
  const changes: InvoiceEdit = {};
  if (inv) {
    if (number.trim() !== inv.invoice_number) changes.invoice_number = number.trim();
    if (date !== inv.issue_date) changes.issue_date = date;
    const nifBefore = (income ? inv.counterparty?.tax_id : inv.issuer_tax_id) ?? "";
    if (nif.trim() !== nifBefore) {
      if (income) changes.counterparty_tax_id = nif.trim();
      else changes.issuer_tax_id = nif.trim();
    }
    if (income && name.trim() !== (inv.counterparty?.name ?? "")) changes.counterparty_name = name.trim();
    if (!income && type !== (inv.expense_type_id ?? "")) changes.expense_type_id = type;
    if (remove.length) changes.remove_lines = remove;
  }
  const fiscal =
    changes.invoice_number !== undefined || changes.issue_date !== undefined || changes.issuer_tax_id !== undefined || !!changes.remove_lines;
  const kept = inv?.lines.filter((l) => !remove.includes(l.line_no)) ?? [];
  const newTotal = kept.reduce((s, l) => s + cents(l.base) + cents(l.vat_amount) - cents(l.withholding_amount), 0) / 100;
  const oldTotal = (inv?.lines ?? []).reduce((s, l) => s + cents(l.base) + cents(l.vat_amount) - cents(l.withholding_amount), 0) / 100;

  function save() {
    startTransition(async () => {
      const r = await editInvoice(invoiceId, changes, reason);
      if (r.ok) {
        toast.success(fiscal ? "Factura corregida (la anterior queda anulada y enlazada)" : "Factura actualizada");
        onClose();
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Corregir datos</DialogTitle>
          <DialogDescription>
            {inv ? `${income ? (inv.counterparty?.name ?? "—") : inv.issuer_name} · ${inv.invoice_number}` : "Cargando…"}
          </DialogDescription>
        </DialogHeader>

        {!inv ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {inv.review_reasons.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {inv.review_reasons.map((r) => (
                  <Badge key={r} className="bg-warning/15 text-warning">
                    {REVIEW_REASONS[r] ?? r}
                  </Badge>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nº de factura" flagged={flagged.has("number")}>
                <Input value={number} onChange={(e) => setNumber(e.target.value)} />
              </Field>
              <Field label="Fecha" flagged={false}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {income ? (
                <>
                  <Field label="NIF del paciente" flagged={flagged.has("nif")} hint="Se guarda en la ficha del paciente.">
                    <Input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="Sin NIF" />
                  </Field>
                  <Field label="Nombre del paciente" flagged={false}>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="NIF / CIF del proveedor"
                    flagged={flagged.has("nif")}
                    hint={inv.review_reasons.includes("nif_emisor_es_la_clinica") ? "Ahora tiene el CIF de la clínica: pon el del proveedor." : undefined}
                  >
                    <Input value={nif} onChange={(e) => setNif(e.target.value)} placeholder="Sin NIF" />
                  </Field>
                  <Field label="Tipo de gasto" flagged={flagged.has("type")}>
                    <select className={SELECT} value={type} onChange={(e) => setType(e.target.value)}>
                      <option value="">Sin tipo de gasto</option>
                      {inv.expenseTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
            </div>

            <Field
              label="Líneas"
              flagged={flagged.has("lines")}
              hint={
                inv.lines.length > 1
                  ? "Marca la línea repetida para quitarla: la factura queda con las demás y el total se recalcula."
                  : undefined
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    {inv.lines.length > 1 && <th className="w-16 font-normal">Quitar</th>}
                    <th className="font-normal">Concepto</th>
                    <th className="text-right font-normal">Base</th>
                    <th className="text-right font-normal">IVA</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {inv.lines.map((l) => {
                    const removed = remove.includes(l.line_no);
                    return (
                      <tr key={l.line_no} className={cn(removed && "text-muted-foreground line-through")}>
                        {inv.lines.length > 1 && (
                          <td>
                            <Checkbox
                              aria-label={`Quitar la línea ${l.line_no}`}
                              checked={removed}
                              disabled={!removed && kept.length === 1}
                              onCheckedChange={(c) =>
                                setRemove((prev) => (c ? [...prev, l.line_no] : prev.filter((n) => n !== l.line_no)))
                              }
                            />
                          </td>
                        )}
                        <td className="truncate">{l.description ?? `Línea ${l.line_no}`}</td>
                        <td className="text-right">{formatCurrency(l.base)}</td>
                        <td className="text-right">
                          {formatCurrency(l.vat_amount)} <span className="text-xs text-muted-foreground">({Math.round(l.vat_rate * 100)} %)</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-right text-sm">
                Total:{" "}
                {remove.length > 0 ? (
                  <>
                    <span className="text-muted-foreground line-through">{formatCurrency(oldTotal)}</span>{" "}
                    <span className="font-semibold">{formatCurrency(newTotal)}</span>
                  </>
                ) : (
                  <span className="font-semibold">{formatCurrency(oldTotal)}</span>
                )}
              </p>
            </Field>

            {fiscal && (
              <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                Cambias datos fiscales (nº, fecha, NIF del proveedor o líneas): la factura actual se anula y se crea la
                correcta enlazada{inv.posted ? ", rectificando su asiento" : ""}. Si Optimydent vuelve a mandar el dato
                antiguo, se ignorará. Corrígelo también en Optimydent.
              </p>
            )}
            <Textarea
              placeholder={fiscal ? "Motivo (obligatorio, mín. 10 caracteres)" : "Nota (opcional)"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={pending || !inv || Object.keys(changes).length === 0} onClick={save}>
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
