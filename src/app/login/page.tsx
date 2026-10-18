import Image from "next/image";
import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { AlertCircle } from "lucide-react";
import { MicrosoftSignInButton } from "@/components/auth/microsoft-signin-button";

export const metadata: Metadata = { title: "Iniciar sesión | ERP Clínica Carmen Fontes" };

// Pantalla de entrada heredada del primer ERP (repo ERPclinica): foto de la
// clínica con velo malva + tarjeta flotante. El acceso es con Microsoft (solo
// admin@), no con email y contraseña.
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-dm" });

const ERROR_MESSAGES: Record<string, string> = {
  oauth_failed: "No se ha podido iniciar sesión. Inténtalo de nuevo.",
  not_allowed: "El ERP contable solo está disponible para la cuenta de administración de la clínica.",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { error, detail } = await props.searchParams;
  const errorMessage = typeof error === "string" ? ERROR_MESSAGES[error] : undefined;
  const errorDetail = typeof detail === "string" ? detail : undefined;

  return (
    <div className={`${dmSans.variable} flex h-full w-full overflow-hidden bg-[#FFFBF7] font-[family-name:var(--font-dm)] text-[#4A4040]`}>
      {/* Izquierda: la clínica */}
      <div className="relative hidden w-1/2 flex-col items-center justify-center overflow-hidden p-12 text-center lg:flex">
        <Image src="/assets/clinica.jpeg" alt="" fill priority sizes="50vw" className="object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#B38B91] to-[#6D4C53] opacity-90 mix-blend-multiply" />

        <div className="relative z-10 flex animate-in flex-col items-center duration-1000 fade-in zoom-in-95">
          <div className="mb-8 drop-shadow-xl transition-transform duration-700 hover:scale-105">
            <Image src="/assets/logo-completo.svg" alt="Clínica Carmen Fontes" width={420} height={70} priority className="h-auto w-[420px] max-w-full" />
          </div>
          <div className="max-w-md space-y-4">
            <div className="mx-auto mb-4 h-px w-16 bg-white/40" />
            <p className="font-montserrat text-xl leading-relaxed font-light tracking-wide text-white/90 italic">
              &ldquo;Excelencia clínica y gestión integral para el cuidado de tu salud y belleza.&rdquo;
            </p>
          </div>
        </div>

        <div className="absolute bottom-8 font-montserrat text-[10px] tracking-[0.2em] text-white/40 uppercase">
          Clínica Carmen Fontes © {new Date().getFullYear()}
        </div>
      </div>

      {/* Derecha: tarjeta de acceso */}
      <div className="relative flex w-full flex-col items-center justify-center bg-[#FFFBF7] p-4 sm:p-8 lg:w-1/2">
        <div className="mb-8 lg:hidden">
          <Image src="/assets/logo.svg" alt="Clínica Carmen Fontes" width={160} height={48} priority />
        </div>
        <div className="w-full max-w-[420px] animate-in rounded-[32px] border border-white/60 bg-white/50 p-8 shadow-[0_20px_40px_-15px_rgba(180,150,150,0.1)] backdrop-blur-sm transition-shadow duration-700 slide-in-from-right-8 hover:shadow-[0_25px_50px_-12px_rgba(180,150,150,0.2)] sm:p-10">
          <div className="mb-8 text-left">
            <h1 className="mb-2 font-montserrat text-3xl font-medium tracking-tight text-[#5D4044]">Bienvenido</h1>
            <p className="text-sm text-[#9C8C90]">Área privada de gestión contable.</p>
          </div>

          {errorMessage && (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[#FCDCDC] bg-[#FFF0F0] p-4 text-sm font-medium text-[#9F1239] shadow-sm">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>
                {errorMessage}
                {errorDetail && <span className="mt-1 block text-xs font-normal opacity-70">{errorDetail}</span>}
              </span>
            </div>
          )}

          <MicrosoftSignInButton />

          <p className="mt-8 text-center text-xs text-[#B07D85]">
            Acceso exclusivo con la cuenta de administración de Microsoft 365 de la clínica.
          </p>
        </div>
      </div>
    </div>
  );
}
