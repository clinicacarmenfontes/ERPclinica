import type { Metadata } from "next";
import { InvoicesPage } from "@/components/erp/invoices-page";
import { requireAdminPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Gastos | ERP Clínica Carmen Fontes" };

export default async function GastosPage(props: PageProps<"/dashboard/gastos">) {
  await requireAdminPage();
  return <InvoicesPage direction="recibida" searchParams={await props.searchParams} />;
}
