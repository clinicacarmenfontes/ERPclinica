import type { Metadata } from "next";
import { ComingSoon } from "@/components/erp/coming-soon";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Contabilidad | ERP Clínica Carmen Fontes" };

export default async function ContabilidadPage() {
  await requireAdminPage();
  return (
    <ComingSoon
      title="Contabilidad"
      description="Libro Diario inmutable, Mayor, Balance y Pérdidas y Ganancias."
      items={[
        "Contabilización automática de cada factura (ya está la función de posteo con cadena de hashes)",
        "Libro Diario y Mayor por cuenta y tercero",
        "Balance de situación vivo y P&G por partidas analíticas",
        "Asientos manuales (amortizaciones, ajustes del gestor) y rectificaciones",
      ]}
    />
  );
}
