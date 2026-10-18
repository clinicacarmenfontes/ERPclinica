import type { Metadata } from "next";
import { ComingSoon } from "@/components/erp/coming-soon";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Fiscal | ERP Clínica Carmen Fontes" };

export default async function FiscalPage() {
  await requireAdminPage();
  return (
    <ComingSoon
      title="Fiscal"
      description="Información trimestral y anual para el gestor."
      items={[
        "Modelos 303 (con prorrata), 111 y 115 en vivo por trimestre",
        "Cierre y reapertura de trimestre (con motivo)",
        "Excel del gestor versionado (Ingresos, Gastos con Base/IVA/IRPF/Total/NIF, Saldos)",
        "Anual: 390, 190, 180, borrador del 347 y Excel anual",
      ]}
    />
  );
}
