import type { Metadata } from "next";
import { InvoicesPage } from "@/components/erp/invoices-page";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Ingresos | ERP Clínica Carmen Fontes" };

export default async function IngresosPage(props: PageProps<"/dashboard/ingresos">) {
  await requireAdminPage();
  return <InvoicesPage direction="emitida" searchParams={await props.searchParams} />;
}
