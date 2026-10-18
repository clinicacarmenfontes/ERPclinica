"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function MicrosoftSignInButton({ config }: { config: { url: string; publishableKey: string } }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const supabase = createClient(config);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // offline_access + Files.Read.All (delegado): el ERP lee la carpeta de
        // facturas que info@ comparte con admin@, y nada más que eso.
        scopes: "email openid profile offline_access Files.Read.All",
        // Guía a Microsoft hacia el tenant de la clínica — comodidad de UX,
        // no un control de seguridad (la app/auth/callback ya valida el dominio).
        queryParams: { domain_hint: "clinicacarmenfontes.com" },
      },
    });

    if (error) setPending(false);
  }

  // Estilo del botón "Acceder" del primer ERP (malva, redondeado, en mayúsculas).
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#8A5A62] py-4 font-montserrat text-sm font-medium tracking-widest text-white uppercase shadow-[0_10px_25px_-5px_rgba(138,90,98,0.3)] transition-all duration-300 hover:-translate-y-1 hover:bg-[#6D454B] hover:shadow-[0_15px_30px_-5px_rgba(138,90,98,0.4)] disabled:translate-y-0 disabled:opacity-70"
    >
      {pending ? (
        <Loader2 size={20} className="animate-spin" />
      ) : (
        <>
          <svg aria-hidden="true" viewBox="0 0 21 21" className="size-4">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          Acceder con Microsoft <ArrowRight size={18} />
        </>
      )}
    </button>
  );
}
