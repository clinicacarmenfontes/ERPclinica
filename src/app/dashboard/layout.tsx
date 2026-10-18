import Image from "next/image";
import { requireAdminPage } from "@/lib/auth/session";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  // Red de seguridad además del proxy: sin admin@ no se renderiza nada.
  const user = await requireAdminPage();

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col gap-6 bg-sidebar p-4">
        <div className="flex flex-col gap-1 px-2 pt-2">
          <Image
            src="/assets/logo.svg"
            alt="Clínica Carmen Fontes"
            width={130}
            height={39}
            className="brightness-0 invert"
            priority
          />
          <span className="font-montserrat text-[10px] tracking-[0.2em] text-sidebar-foreground/50 uppercase">
            ERP contable
          </span>
        </div>
        <SidebarNav />
        <div className="mt-auto">
          <UserMenu email={user.email ?? ""} />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-background">{children}</main>
    </div>
  );
}
