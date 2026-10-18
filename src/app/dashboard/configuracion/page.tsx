import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/erp/common";
import { requireAdminPage } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Configuración | ERP Clínica Carmen Fontes" };

type ExpenseType = {
  id: string;
  name: string;
  account_code: string | null;
  behavior: string | null;
  withholding_model: string | null;
  needs_review: boolean;
  accounts: { name: string } | null;
  expense_categories: { name: string; color: string } | null;
};

export default async function ConfiguracionPage() {
  await requireAdminPage();
  const db = createAdminClient();
  const [types, settings] = await Promise.all([
    db
      .from("expense_types")
      .select("id, name, account_code, behavior, withholding_model, needs_review, accounts(name), expense_categories(name, color)")
      .order("needs_review", { ascending: false })
      .order("name")
      .returns<ExpenseType[]>(),
    db.from("company_settings").select("legal_name, tax_id, vat_prorrata_pct, missing_invoice_alert_day").single(),
  ]);
  if (types.error) throw types.error;
  if (settings.error) throw settings.error;
  const pending = types.data.filter((t) => t.needs_review).length;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Configuración"
        description="Datos maestros. La edición desde aquí llega con el siguiente paso; las reglas de qué se puede editar están en docs/procedimientos-edicion.md."
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Sociedad</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Razón social</p>
            <p className="font-medium">{settings.data.legal_name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">CIF</p>
            <p className="font-medium">{settings.data.tax_id}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Prorrata de IVA</p>
            <p className="font-medium">{Number(settings.data.vat_prorrata_pct)} % (pendiente de fijar con el gestor)</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Aviso de facturas recurrentes</p>
            <p className="font-medium">día {settings.data.missing_invoice_alert_day}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat">Tipos de gasto → cuenta y partida</CardTitle>
          <CardDescription>
            {types.data.length} tipos (Optimydent). {pending > 0 && `${pending} marcados para revisar con el gestor: su cuenta del CSV original es dudosa o son nuevos.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo de gasto</TableHead>
                <TableHead>Cuenta</TableHead>
                <TableHead>Partida</TableHead>
                <TableHead>Comportamiento</TableHead>
                <TableHead>Retención</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    {t.name} {t.needs_review && <Badge className="ml-1 bg-warning/15 text-warning">Revisar</Badge>}
                  </TableCell>
                  <TableCell className="text-sm">
                    {t.account_code ? (
                      <>
                        <span className="tabular-nums">{t.account_code}</span>{" "}
                        <span className="text-muted-foreground">{t.accounts?.name}</span>
                      </>
                    ) : (
                      <span className="text-destructive">Sin cuenta</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {t.expense_categories ? (
                      <Badge variant="outline" className="gap-1">
                        <span className="size-2 rounded-full" style={{ backgroundColor: t.expense_categories.color }} />
                        {t.expense_categories.name}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-sm capitalize">{t.behavior ?? "—"}</TableCell>
                  <TableCell className="text-sm">{t.withholding_model ? `Mod. ${t.withholding_model}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
