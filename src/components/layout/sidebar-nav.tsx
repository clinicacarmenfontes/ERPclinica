"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  ClipboardCheck,
  FolderOpen,
  Landmark,
  LayoutDashboard,
  Receipt,
  RefreshCw,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/revision", label: "Revisión", icon: ClipboardCheck, exact: false },
  { href: "/dashboard/ingresos", label: "Ingresos", icon: ArrowDownToLine, exact: false },
  { href: "/dashboard/gastos", label: "Gastos", icon: ArrowUpFromLine, exact: false },
  { href: "/dashboard/tesoreria", label: "Tesorería", icon: Landmark, exact: false },
  { href: "/dashboard/contabilidad", label: "Contabilidad", icon: BookOpen, exact: false },
  { href: "/dashboard/nominas", label: "Nóminas", icon: Users, exact: false },
  { href: "/dashboard/fiscal", label: "Fiscal", icon: Receipt, exact: false },
  { href: "/dashboard/sincronizacion", label: "Sincronización", icon: RefreshCw, exact: false },
  { href: "/dashboard/repositorio", label: "Repositorio", icon: FolderOpen, exact: false },
  { href: "/dashboard/configuracion", label: "Configuración", icon: Settings, exact: false },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 font-montserrat text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
