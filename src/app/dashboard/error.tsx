"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Si falla la carga se avisa, en vez de mostrar cifras vacías como si fueran reales. */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-montserrat text-sm font-semibold text-foreground">No se han podido cargar los datos.</p>
      <p className="text-sm text-muted-foreground">Suele ser un fallo puntual de conexión con la base de datos.</p>
      <Button size="sm" onClick={() => retry()}>
        Reintentar
      </Button>
    </div>
  );
}
