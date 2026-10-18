import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserMenu({ email }: { email: string }) {
  const initial = email.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-sidebar-border p-3">
      <Avatar className="size-8">
        <AvatarFallback className="bg-sidebar-primary font-montserrat text-xs text-sidebar-primary-foreground">
          {initial}
        </AvatarFallback>
      </Avatar>
      <p className="flex-1 truncate text-xs text-sidebar-foreground/80">{email}</p>
      <form method="post" action="/auth/signout">
        <button
          type="submit"
          title="Cerrar sesión"
          className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
