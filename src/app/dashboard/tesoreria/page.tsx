import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, KpiCard, PageHeader } from "@/components/erp/common";
import { requireAdminPage } from "@/lib/auth/session";
import { formatCurrency, formatDate } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tesorería | ERP Clínica Carmen Fontes" };

type Account = { id: string; name: string; bank: string; account_number: string | null; account_code: string };
type Latest = { bank_account_id: string; booking_date: string; balance_after: number };
type Break = { bank_account_id: string; booking_date: string; description: string; missing_previous_balance: number };
type Tx = { id: string; booking_date: string; value_date: string | null; description: string; amount: number; balance_after: number | null };

export default async function TesoreriaPage(props: PageProps<"/dashboard/tesoreria">) {
  await requireAdminPage();
  const { cuenta } = await props.searchParams;
  const db = createAdminClient();
  const [accounts, latest, breaks] = await Promise.all([
    db.from("bank_accounts").select("id, name, bank, account_number, account_code").neq("bank", "caja").order("name").returns<Account[]>(),
    db.from("v_bank_latest_balance").select("*").returns<Latest[]>(),
    db.from("v_bank_chain_breaks").select("bank_account_id, booking_date, description, missing_previous_balance").returns<Break[]>(),
  ]);
  for (const r of [accounts, latest, breaks]) if (r.error) throw r.error;

  const selected = accounts.data!.find((a) => a.id === cuenta) ?? accounts.data![0];
  const { data: txs, error } = await db
    .from("bank_transactions")
    .select("id, booking_date, value_date, description, amount, balance_after")
    .eq("bank_account_id", selected.id)
    .order("booking_date", { ascending: false })
    .limit(300)
    .returns<Tx[]>();
  if (error) throw error;

  const latestOf = (id: string) => latest.data!.find((l) => l.bank_account_id === id);
  const breaksOf = (id: string) => breaks.data!.filter((b) => b.bank_account_id === id);

  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader
        title="Tesorería"
        description="Movimientos cargados desde los ficheros de cada banco. La conciliación con facturas se hará en cada cierre trimestral (siguiente paso)."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {accounts.data!.map((a) => {
          const l = latestOf(a.id);
          const gaps = breaksOf(a.id).length;
          return (
            <Link key={a.id} href={`/dashboard/tesoreria?cuenta=${a.id}`} className="block">
              <div className={cn("rounded-xl ring-2 ring-transparent transition", a.id === selected.id && "ring-primary")}>
                <KpiCard
                  label={`${a.name}${a.account_number ? ` · …${a.account_number.slice(-4)}` : ""}`}
                  value={l ? formatCurrency(l.balance_after) : "—"}
                  hint={l ? `Saldo según el último movimiento cargado (${formatDate(l.booking_date)})${gaps ? ` · ${gaps} hueco(s)` : ""}` : "Sin movimientos cargados"}
                  accent={a.id === selected.id}
                />
              </div>
            </Link>
          );
        })}
      </div>

      {breaksOf(selected.id).length > 0 && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            <p className="font-medium">Faltan movimientos por cargar en {selected.name}</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {breaksOf(selected.id).map((b, i) => (
                <li key={i}>
                  Antes del {formatDate(b.booking_date)} («{b.description}»): el saldo anterior debería ser{" "}
                  {formatCurrency(b.missing_previous_balance)} y no aparece en ningún movimiento cargado. Descarga y sube
                  el tramo que falta.
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {txs.length === 0 ? (
        <EmptyState>
          No hay movimientos de {selected.name}. Súbelos desde{" "}
          <Link href="/dashboard/sincronizacion" className="text-primary underline">
            Sincronización
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txs.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(t.booking_date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.value_date)}</TableCell>
                  <TableCell className="max-w-96 truncate">{t.description}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", Number(t.amount) < 0 ? "text-destructive" : "text-success")}>
                    {formatCurrency(t.amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {t.balance_after !== null ? formatCurrency(t.balance_after) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
