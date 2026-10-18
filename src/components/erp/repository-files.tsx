"use client";

import { useMemo, useState, useTransition } from "react";
import { FolderSync, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { readItemsAction, refreshInventoryAction } from "@/app/dashboard/repositorio/actions";
import { ROLE_LABELS, type RepositoryRole } from "@/lib/repository/paths";

export type RepositoryFile = {
  id: string;
  name: string;
  path: string;
  role: RepositoryRole;
  /** sin_leer | vinculado | pendiente | contabilizado | descartado | error */
  state: string;
  error: string | null;
};

const STATE: Record<string, { label: string; className: string }> = {
  sin_leer: { label: "Sin leer", className: "bg-muted text-muted-foreground" },
  vinculado: { label: "Justificante vinculado", className: "bg-success/15 text-success" },
  contabilizado: { label: "Contabilizada", className: "bg-success/15 text-success" },
  pendiente: { label: "En la bandeja", className: "bg-warning/15 text-warning" },
  descartado: { label: "Descartado", className: "bg-muted text-muted-foreground line-through" },
  error: { label: "Error", className: "bg-destructive/10 text-destructive" },
};

const ROLE_ORDER: RepositoryRole[] = ["profesional", "emitida", "pendiente_registrar", "registrada_optimydent"];
const BATCH = 8;

export function RefreshInventoryButton({ disabled }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || disabled}
      onClick={() =>
        startTransition(async () => {
          const r = await refreshInventoryAction();
          if (r.ok) toast.success(`Listado actualizado: ${r.data.listed} ficheros · ${r.data.unread} sin leer`);
          else toast.error(r.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <FolderSync />}
      Actualizar listado
    </Button>
  );
}

/**
 * Ficheros del trimestre agrupados por carpeta. Solo se leen con Claude los que
 * marques: nada se lee automáticamente.
 */
export function RepositoryFiles({ files, canRead }: { files: RepositoryFile[]; canRead: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groups = useMemo(
    () => ROLE_ORDER.map((role) => ({ role, files: files.filter((f) => f.role === role) })).filter((g) => g.files.length),
    [files],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const readable = (f: RepositoryFile) => f.state === "sin_leer" || f.state === "error";

  function read() {
    const ids = [...selected];
    startTransition(async () => {
      const totals = { processed: 0, linked: 0, pending: 0, discarded: 0, errors: 0 };
      let queue = ids;
      while (queue.length) {
        setProgress(`Leyendo… ${totals.processed} de ${ids.length}`);
        const batch = queue.slice(0, BATCH);
        const r = await readItemsAction(batch);
        if (!r.ok) {
          toast.error(r.message);
          break;
        }
        totals.processed += r.data.processed;
        totals.linked += r.data.linked;
        totals.pending += r.data.pending;
        totals.discarded += r.data.discarded;
        totals.errors += r.data.errors.length;
        queue = [...r.data.remaining, ...queue.slice(BATCH)];
        if (r.data.processed === 0 && r.data.errors.length === 0) break;
      }
      setProgress(null);
      setSelected(new Set());
      toast.success(
        `${totals.processed} leídas · ${totals.linked} vinculadas · ${totals.pending} a la bandeja` +
          (totals.discarded ? ` · ${totals.discarded} descartadas` : "") +
          (totals.errors ? ` · ${totals.errors} con error` : ""),
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={read} disabled={!canRead || pending || selected.size === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Leer con Claude ({selected.size})
        </Button>
        <span className="text-xs text-muted-foreground">
          {progress ?? "Marca los ficheros que quieras leer. Cada lectura tiene un pequeño coste."}
        </span>
      </div>

      {groups.map((g) => {
        const candidates = g.files.filter(readable);
        const allSelected = candidates.length > 0 && candidates.every((f) => selected.has(f.id));
        return (
          <div key={g.role} className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <p className="font-montserrat text-sm font-semibold">
                {ROLE_LABELS[g.role]} <span className="font-normal text-muted-foreground">· {g.files.length}</span>
              </p>
              {candidates.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setSelected((s) => {
                      const n = new Set(s);
                      for (const f of candidates) {
                        if (allSelected) n.delete(f.id);
                        else n.add(f.id);
                      }
                      return n;
                    })
                  }
                >
                  {allSelected ? "Quitar selección" : `Seleccionar las ${candidates.length} sin leer`}
                </button>
              )}
            </div>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {g.files.map((f) => {
                const st = STATE[f.state] ?? STATE.sin_leer;
                return (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      disabled={!readable(f) || pending}
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                      aria-label={`Seleccionar ${f.name}`}
                    />
                    <span className="min-w-0 flex-1 truncate" title={f.error ?? f.path}>
                      {f.name}
                    </span>
                    <Badge className={st.className}>{st.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
