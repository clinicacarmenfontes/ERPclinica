import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/erp/common";
import { ExpenseTypeEditor } from "@/components/erp/expense-type-editor";
import { ProrrataEditor } from "@/components/erp/prorrata-editor";
import { requireAdminPage } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Configuración | ERP Clínica Carmen Fontes" };

type ExpenseType = {
  id: string;
  name: string;
  account_code: string | null;
  category_id: string | null;
  behavior: string | null;
  withholding_model: string | null;
  needs_review: boolean;
  accounts: { name: string } | null;
  expense_categories: { name: string; color: string } | null;
};

export default async function ConfiguracionPage() {
  await requireAdminPage();
  const db = createAdminClient();
  const [types, settings, accounts, categories] = await Promise.all([
    db
      .from("expense_types")
      .select("id, name, account_code, category_id, behavior, withholding_model, needs_review, accounts(name), expense_categories(name, color)")
      .order("needs_review", { ascending: false })
      .order("name")
      .returns<ExpenseType[]>(),
    db.from("company_settings").select("legal_name, tax_id, vat_prorrata_pct, missing_invoice_alert_day").single(),
    db
      .from("accounts")
      .select("code, name")
      .eq("kind", "gasto")
      .eq("active", true)
      .eq("is_auxiliary", false)
      .order("code")
      .returns<{ code: string; name: string }[]>(),
    db.from("expense_categories").select("id, name").order("position").returns<{ id: string; name: string }[]>(),
  ]);
  if (types.error) throw types.error;
  if (settings.error) throw settings.error;
  if (accounts.error) throw accounts.error;
  if (categories.error) throw categories.error;
  const pending = types.data.filter((t) => t.needs_review).length;

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Configuración"
        description="Datos maestros. Los tipos de gasto se editan aquí: su cuenta contable y su partida se aplican a todas sus facturas."
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
            <ProrrataEditor value={Number(settings.data.vat_prorrata_pct)} />
            <p className="mt-1 text-xs text-muted-foreground">% deducible del IVA soportado (lo fija el gestor).</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Aviso de facturas recurrentes</p>
            <p className="font-medium">día {settings.data.missing_invoice_alert_day}</p>
          </div>
        </CardContent>
      </Card>

      <Card id="tipos">
        <CardHeader>
          <CardTitle className="font-montserrat">Tipos de gasto → cuenta y partida</CardTitle>
          <CardDescription>
            {types.data.length} tipos (Optimydent). {pending > 0 && `${pending} marcados para revisar: son nuevos o su cuenta es dudosa. Asígnales cuenta y partida.`}
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
                <TableHead className="w-32" />
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
                  <TableCell className="text-right">
                    <ExpenseTypeEditor type={t} accounts={accounts.data} categories={categories.data} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
