"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { setExpenseType } from "@/app/dashboard/configuracion/actions";

const SELECT =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Asignar cuenta contable y partida a un tipo de gasto. */
export function ExpenseTypeEditor({
  type,
  accounts,
  categories,
}: {
  type: { id: string; name: string; account_code: string | null; category_id: string | null; needs_review: boolean };
  accounts: { code: string; name: string }[];
  categories: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(type.account_code ?? "");
  const [category, setCategory] = useState(type.category_id ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const r = await setExpenseType(type.id, { accountCode: account, categoryId: category });
      if (r.ok) {
        toast.success(`«${type.name}» actualizado${r.invoices ? ` · ${r.invoices} factura(s) corregidas` : ""}`);
        setOpen(false);
      } else {
        toast.error(r.message);
      }
    });
  }

  return (
    <>
      <Button size="sm" variant={type.needs_review || !type.account_code ? "default" : "outline"} onClick={() => setOpen(true)}>
        {type.account_code ? "Editar" : "Asignar cuenta"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{type.name}</DialogTitle>
            <DialogDescription>
              Las facturas con este tipo de trimestres abiertos se reclasifican (salvo las que cambiaste a mano), las líneas
              sin cuenta reciben esta y dejan de estar marcadas como «tipo de gasto nuevo».
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`acc-${type.id}`} className="text-xs text-muted-foreground">
                Cuenta contable
              </Label>
              <select id={`acc-${type.id}`} className={SELECT} value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">Elige una cuenta…</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`cat-${type.id}`} className="text-xs text-muted-foreground">
                Partida
              </Label>
              <select id={`cat-${type.id}`} className={SELECT} value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Elige una partida…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={pending || !account || !category} onClick={save}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
