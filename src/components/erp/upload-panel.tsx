"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Copy, FileUp, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadDocument } from "@/app/dashboard/sincronizacion/actions";
import type { IngestReport } from "@/lib/ingest/pipeline";
import { cn } from "@/lib/utils";

const STAT_LABELS: Record<string, string> = {
  insertada: "nuevas",
  actualizada: "actualizadas",
  sin_cambios: "sin cambios",
  conflicto: "conflictos",
  conflicto_pendiente: "conflictos ya pendientes",
  ignorada_anulada: "ignoradas (anuladas antes)",
  ignorada_resuelta: "ignoradas (ya resueltas)",
  periodo_cerrado: "en trimestre cerrado",
  error: "con error",
  revision: "para revisar",
  insertados: "movimientos nuevos",
  duplicados: "movimientos ya cargados",
  insertada_snapshot: "foto nueva",
  pacientes: "pacientes",
};

const ICON = {
  ok: <CheckCircle2 className="size-4 text-success" />,
  avisos: <CircleAlert className="size-4 text-warning" />,
  repetido: <Copy className="size-4 text-muted-foreground" />,
  error: <XCircle className="size-4 text-destructive" />,
};

export function UploadPanel({ today }: { today: string }) {
  const [reports, setReports] = useState<IngestReport[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [asOf, setAsOf] = useState(today);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function processFiles(files: File[]) {
    if (files.length === 0) return;
    startTransition(async () => {
      for (const file of files) {
        setCurrent(file.name);
        const fd = new FormData();
        fd.set("file", file);
        fd.set("asOf", asOf);
        try {
          const report = await uploadDocument(fd);
          setReports((prev) => [report, ...prev]);
        } catch (e) {
          setReports((prev) => [
            { fileName: file.name, status: "error", message: e instanceof Error ? e.message : "Error inesperado", warnings: [] },
            ...prev,
          ]);
        }
      }
      setCurrent(null);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-montserrat">Subir ficheros</CardTitle>
        <CardDescription>
          Listados de Optimydent en PDF (gastos, facturas emitidas, pacientes acreedores y deudores), PDF de movimientos de
          Kutxabank y CSV de CaixaBank. Se reconocen por su contenido; puedes subir varios a la vez y repetir sin miedo: lo
          ya cargado no se duplica.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            processFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => !pending && inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60",
            pending && "cursor-wait opacity-70",
          )}
        >
          {pending ? <Loader2 className="size-6 animate-spin text-primary" /> : <FileUp className="size-6 text-primary" />}
          <p className="text-sm font-medium">{pending ? `Procesando ${current ?? ""}…` : "Arrastra aquí los ficheros o haz clic"}</p>
          <p className="text-xs text-muted-foreground">PDF o CSV · máx. 4 MB por fichero</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.csv,application/pdf,text/csv"
            className="hidden"
            onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="asOf" className="text-xs text-muted-foreground">
            Fecha de los listados de saldos de pacientes
          </Label>
          <Input id="asOf" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
          <span className="text-xs text-muted-foreground">Optimydent no la incluye en el PDF: por defecto, hoy.</span>
        </div>

        {reports.length > 0 && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {reports.map((r, i) => (
              <li key={`${r.fileName}-${i}`} className="flex flex-col gap-1 p-3 text-sm">
                <div className="flex items-center gap-2">
                  {ICON[r.status]}
                  <span className="font-medium">{r.fileName}</span>
                </div>
                {r.summary && <p className="text-muted-foreground">{r.summary}</p>}
                {r.message && <p className={r.status === "error" ? "text-destructive" : "text-muted-foreground"}>{r.message}</p>}
                {r.stats && (
                  <p className="text-xs text-muted-foreground">
                    {Object.entries(r.stats)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => `${n} ${STAT_LABELS[k] ?? k.replace(/_/g, " ")}`)
                      .join(" · ")}
                  </p>
                )}
                {r.warnings.length > 0 && (
                  <details className="text-xs text-warning">
                    <summary className="cursor-pointer">{r.warnings.length} avisos</summary>
                    <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                      {r.warnings.slice(0, 30).map((w, j) => (
                        <li key={j}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
        {reports.length > 0 && !pending && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => setReports([])}>
            Limpiar resultados
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
