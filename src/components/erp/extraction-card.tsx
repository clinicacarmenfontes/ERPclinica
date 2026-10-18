"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  bookExtractionAction,
  discardExtractionAction,
  linkExtractionAction,
  type BookForm,
} from "@/app/dashboard/repositorio/actions";
import { REVIEW_REASONS } from "@/components/erp/common";
import { formatCurrency, formatDate } from "@/lib/format";
import type { NormalizedInvoice } from "@/lib/ingest/types";
import { ROLE_LABELS, type RepositoryRole } from "@/lib/repository/paths";

export type ExtractionView = {
  id: string;
  documentId: string;
  fileName: string;
  path: string | null;
  role: RepositoryRole;
  confidence: number | null;
  reasons: string[];
  draft: NormalizedInvoice | null;
  documentType: string;
  notes: string | null;
  candidates: { id: string; invoice_number: string; issuer_name: string; issue_date: string; total: number; score: number }[];
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ExtractionCard({ item, expenseTypes }: { item: ExtractionView; expenseTypes: string[] }) {
  const d = item.draft;
  const isIncome = d?.direction === "emitida" || item.role === "emitida";
  const [form, setForm] = useState<BookForm>({
    direction: isIncome ? "emitida" : "recibida",
    issuer_name: d?.issuer_name ?? "",
    issuer_tax_id: d?.issuer_tax_id ?? "",
    counterparty_name: d?.counterparty?.name ?? "",
    counterparty_tax_id: d?.counterparty?.tax_id ?? "",
    invoice_number: d?.invoice_number ?? "",
    issue_date: d?.issue_date ?? "",
    base: d?.base_total ?? 0,
    vat: d?.vat_total ?? 0,
    withholding: d?.withholding_total ?? 0,
    expense_type: d?.expense_type ?? "",
  });
  const [discardReason, setDiscardReason] = useState("");
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof BookForm>(k: K, v: BookForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const total = Math.round((form.base + form.vat - form.withholding) * 100) / 100;
  const waitForOptimydent = item.role === "pendiente_registrar" || item.role === "registrada_optimydent";

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.message ?? "No se pudo completar");
    });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={`/api/documentos/${item.documentId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            {item.fileName} <ExternalLink className="size-3.5" />
          </a>
          <p className="truncate text-xs text-muted-foreground">{item.path}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{ROLE_LABELS[item.role]}</Badge>
          {item.confidence !== null && (
            <Badge variant="outline">Confianza {Math.round(Number(item.confidence) * 100)} %</Badge>
          )}
        </div>
      </div>

      {item.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.reasons.map((r) => (
            <Badge key={r} className="bg-warning/15 text-warning">
              {REVIEW_REASONS[r] ?? r}
            </Badge>
          ))}
        </div>
      )}
      {item.notes && <p className="text-xs text-muted-foreground">Nota de la lectura: {item.notes}</p>}

      {item.candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">¿Es alguna de estas facturas ya registradas?</p>
          {item.candidates.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
              <span>
                {c.issuer_name} · <span className="font-medium">{c.invoice_number}</span> · {formatDate(c.issue_date)} ·{" "}
                {formatCurrency(c.total)} <span className="text-xs text-muted-foreground">({Math.round(c.score * 100)} %)</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => act(() => linkExtractionAction(item.id, c.id), "Vinculada como justificante")}
              >
                <Link2 /> Es esta
              </Button>
            </div>
          ))}
        </div>
      )}

      {d || item.documentType !== "otro" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label={isIncome ? "Emisor (la clínica)" : "Proveedor / profesional"}>
            <Input value={form.issuer_name} onChange={(e) => set("issuer_name", e.target.value)} disabled={isIncome} />
          </Field>
          <Field label="NIF emisor">
            <Input value={form.issuer_tax_id} onChange={(e) => set("issuer_tax_id", e.target.value)} disabled={isIncome} />
          </Field>
          <Field label="Nº factura">
            <Input value={form.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} />
          </Field>
          <Field label="Fecha">
            <Input type="date" value={form.issue_date} onChange={(e) => set("issue_date", e.target.value)} />
          </Field>
          {isIncome && (
            <>
              <Field label="Cliente">
                <Input value={form.counterparty_name} onChange={(e) => set("counterparty_name", e.target.value)} />
              </Field>
              <Field label="NIF cliente">
                <Input value={form.counterparty_tax_id} onChange={(e) => set("counterparty_tax_id", e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Base">
            <Input type="number" step="0.01" value={form.base} onChange={(e) => set("base", Number(e.target.value))} />
          </Field>
          <Field label="IVA">
            <Input type="number" step="0.01" value={form.vat} onChange={(e) => set("vat", Number(e.target.value))} />
          </Field>
          <Field label="Retención IRPF">
            <Input type="number" step="0.01" value={form.withholding} onChange={(e) => set("withholding", Number(e.target.value))} />
          </Field>
          <Field label="Total a pagar">
            <p className="flex h-8 items-center font-montserrat font-semibold tabular-nums">{formatCurrency(total)}</p>
          </Field>
          {!isIncome && (
            <Field label="Tipo de gasto">
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                value={form.expense_type}
                onChange={(e) => set("expense_type", e.target.value)}
              >
                <option value="">— Sin tipo —</option>
                {expenseTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      ) : null}

      {waitForOptimydent && (
        <p className="text-xs text-muted-foreground">
          Las facturas de proveedor se registran en Optimydent: lo normal es esperar a la próxima sincronización de gastos,
          que la vinculará sola. Contabilízala aquí solo si no se va a picar en Optimydent.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          variant={waitForOptimydent ? "outline" : "default"}
          onClick={() => act(() => bookExtractionAction(item.id, form), "Factura contabilizada")}
        >
          Contabilizar
        </Button>
        <Input
          className="h-8 max-w-64"
          placeholder="Motivo para descartar"
          value={discardReason}
          onChange={(e) => setDiscardReason(e.target.value)}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => act(() => discardExtractionAction(item.id, discardReason), "Documento descartado")}
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}
