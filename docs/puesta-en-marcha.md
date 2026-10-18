# Puesta en marcha del ERP

Igual que el CRM: GitHub → Vercel, Supabase propio y login con Microsoft.
Tiempo estimado: 30–40 minutos. Ningún secreto se escribe en el código ni en este documento.

| Pieza | Valor |
|---|---|
| Dominio | `erp.clinicacarmenfontes.com` |
| Repositorio | `clinicacarmenfontes/ERP` (nuevo, privado) |
| Vercel | proyecto `erp` en el mismo scope que el CRM (`albertos-projects-89d418d7`) |
| Supabase | proyecto **nuevo** `erp-carmen-fontes` (región UE), separado del CRM |
| Único usuario | `admin@clinicacarmenfontes.com` (fijado en `src/lib/auth/allowlist.ts`) |

## 1. Supabase (proyecto nuevo)

1. <https://supabase.com/dashboard> → **New project** → nombre `erp-carmen-fontes`, región *West EU*, contraseña de BBDD fuerte (guárdala en tu gestor).
2. **SQL Editor** → ejecuta, en este orden, el contenido completo de:
   1. `supabase/migrations/20261018000001_core_schema.sql`
   2. `supabase/migrations/20261018000002_seeds_and_ingest.sql`
   3. `supabase/migrations/20261018000003_repository.sql`

   La segunda crea también el bucket privado `documentos` (originales subidos).
3. **Authentication → Sign In / Providers**: desactiva *Email* y deja solo **Azure** (paso 2).
4. **Authentication → URL Configuration**:
   - Site URL: `https://erp.clinicacarmenfontes.com`
   - Redirect URLs: `https://erp.clinicacarmenfontes.com/auth/callback` y `http://localhost:3000/auth/callback`
5. **Project Settings → API Keys**: copia la *URL*, la *publishable key* y la *secret key* (para el paso 3).

## 2. Microsoft Entra ID (login)

Recomendado: un registro de aplicación **propio** para el ERP (no reutilizar el del CRM), así se puede limitar a una sola persona.

1. <https://entra.microsoft.com> → **App registrations → New registration**
   - Nombre: `ERP Carmen Fontes`
   - *Accounts in this organizational directory only* (single tenant)
   - Redirect URI (Web): `https://<ref-del-proyecto>.supabase.co/auth/v1/callback` (aparece en Supabase → Azure provider)
2. **Certificates & secrets → New client secret** (24 meses). Copia el *Value*.
3. En Supabase → **Azure provider**: *Client ID* = Application (client) ID, *Secret* = el value, *Azure Tenant URL* = `https://login.microsoftonline.com/<Directory (tenant) ID>`. Guardar.
4. **Barrera adicional (recomendada)**: Entra → **Enterprise applications → ERP Carmen Fontes → Properties → Assignment required = Yes**, y en *Users and groups* añade solo a `admin@`. Así Microsoft ni siquiera emite la sesión a otra cuenta.

> La app ya bloquea por su cuenta cualquier email distinto de admin@ (proxy → 403, callback → cierra sesión, y cada página o acción lo vuelve a comprobar). El paso 4 añade una barrera más.

## 3. Vercel

1. Crea el repositorio privado `clinicacarmenfontes/ERP` y sube esta carpeta (el `.gitignore` ya excluye `.env*`, `tests/fixtures/private/` y los CSV/PDF de la raíz, que tienen datos reales).
2. Vercel → **Add New → Project** → importa `clinicacarmenfontes/ERP` (framework Next.js, build por defecto, Node 24).
3. **Settings → Environment Variables** (Production y Preview):

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key |
   | `SUPABASE_SECRET_KEY` | secret key (marcar *Sensitive*) |

4. **Settings → Domains** → añade `erp.clinicacarmenfontes.com`. Vercel indica el registro DNS: un `CNAME erp → cname.vercel-dns.com` en el proveedor donde ya está el de `crm`.
5. Redespliega tras guardar las variables (Deployments → ⋯ → Redeploy).

## 4. Repositorio de facturas (OneDrive de info@)

El ERP lee la carpeta con el **mínimo permiso**: info@ la comparte en solo lectura con admin@, y el ERP usa la sesión de admin@. No hay un permiso de aplicación que dé acceso a los archivos de todo el tenant.

1. **Compartir la carpeta**, desde la cuenta info@: en OneDrive web, sobre `Clínica Carmen Fontes/01. Contabilidad/01. Facturas` → *Compartir* → *Personas específicas* → `admin@clinicacarmenfontes.com` → **Puede ver** → *Copiar vínculo*. Ese vínculo es `ONEDRIVE_FOLDER_URL`.
2. **Permiso en Entra**, en el registro "ERP Carmen Fontes" → *API permissions* → *Add* → Microsoft Graph → **Delegated** → `Files.Read.All` y `offline_access`. Es delegado: solo da acceso a lo que admin@ ya puede ver, es decir, a esa carpeta.
3. **Variables en Vercel**, en Production:

   | Variable | Valor |
   |---|---|
   | `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | los mismos del proveedor Azure de Supabase |
   | `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (*Sensitive*) |
   | `ONEDRIVE_FOLDER_URL` | el vínculo del paso 1 |
   | `REPOSITORY_FROM_YEAR` | `2026` |
   | `ANTHROPIC_API_KEY` | clave de la API de Anthropic (*Sensitive*) |

4. Redespliega, **cierra sesión y vuelve a entrar** (Microsoft pedirá aceptar el acceso de lectura) → *Repositorio* → **Sincronizar OneDrive**.

Primera sincronización de 2026: unos 530 ficheros. La lectura es en tandas, y la pantalla sigue sola hasta terminar.

- Coste aproximado con Sonnet: céntimos por factura.
- Los ficheros de PICADAS que casan con Optimydent se vinculan solos como justificante.
- A la bandeja van las facturas de doctoras, las emitidas y lo que no case.

## 5. Comprobación

1. Abre `https://erp.clinicacarmenfontes.com` → login con Microsoft como admin@ → Resumen.
2. Prueba de acceso: en una ventana privada entra con otra cuenta de la clínica → debe salir *Acceso restringido*.
3. **Sincronización** → sube los cuatro PDF de Optimydent del último trimestre y los ficheros de los dos bancos. Resultado esperado con los de 3T2026:
   - Facturas emitidas: 462 nuevas.
   - Gastos: 154 líneas → 135 facturas. Una entra como conflicto (OPTO2026/1013, mismo número en julio y agosto) y varias quedan para revisar: el CIF de DentalMonitoring es el de la clínica, CS26/381 tiene una línea repetida…
   - Saldos: acreedores 70 pacientes (124.117,87 €) y deudores 23 (−4.582,15 €).
   - Si vuelves a subir cualquiera: *ya cargado*, no se duplica.

## Desarrollo en local

```bash
pnpm install
cp .env.example .env.local   # y rellena las tres variables
pnpm dev                     # http://localhost:3000
pnpm test                    # 64 tests: BBDD (PGlite), parsers, carga real y repositorio
```

Los tests con ficheros reales de 3T2026 leen `tests/fixtures/private/`. Esa carpeta no va al repositorio, y sin ella esos tests se saltan.
