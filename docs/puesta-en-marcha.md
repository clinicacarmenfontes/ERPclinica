# Puesta en marcha del ERP

GitHub → Vercel, con login de Microsoft y el **mismo proyecto Supabase que el CRM**: el plan gratuito solo permite 2 proyectos activos. El ERP vive en su propio esquema `erp`.
Ningún secreto se escribe en el código ni en este documento.

| Pieza | Valor |
|---|---|
| Dominio | `erp.clinicacarmenfontes.com` ✅ (CNAME en GoDaddy) |
| Repositorio | `clinicacarmenfontes/ERPclinica` ✅ |
| Vercel | proyecto `er-pclinica` (scope `albertos-projects-89d418d7`) ✅ |
| Supabase | el del CRM, esquema **`erp`** |
| Único usuario | `admin@clinicacarmenfontes.com` (fijado en `src/lib/auth/allowlist.ts`) |

**Aislamiento con el CRM** (comprobado en `tests/coexistence-crm.test.ts` con las migraciones reales de ambos):
- El ERP no crea ni modifica nada en `public`, el esquema del CRM.
- Los usuarios del CRM (`anon` y `authenticated`) no tienen ni permiso de uso sobre `erp`: no pueden listar, leer ni ejecutar nada.
- El ERP usa su propia clave secreta, que se puede revocar sin afectar al CRM, y solo trabaja con el esquema `erp` y el bucket `erp-documentos`.
- Comparten Supabase Auth: admin@ es el mismo usuario en los dos. Si aún no tuviera ficha en el CRM, se creará al entrar por primera vez en el ERP.

## 1. Supabase (proyecto del CRM)

1. **SQL Editor** → ejecuta, en este orden, el contenido completo de:
   1. `supabase/migrations/20261018000001_core_schema.sql`
   2. `supabase/migrations/20261018000002_seeds_and_ingest.sql`
   3. `supabase/migrations/20261018000003_repository.sql`

   Crean el esquema `erp` y el bucket privado `erp-documentos`. No tocan nada del CRM.
2. **Project Settings → Data API → Exposed schemas** → añade `erp` (además de `public`) → *Save*. Lo necesita el servidor del ERP para leer y escribir por la API. Los usuarios del CRM siguen sin acceso, porque no tienen permisos en ese esquema.
3. **Project Settings → API Keys → Secret keys → Create new secret key** → nombre `erp`. Es exclusiva del ERP y se puede revocar sin afectar al CRM.
4. **Authentication → URL Configuration → Redirect URLs** → añade `https://erp.clinicacarmenfontes.com/auth/callback`. Deja el *Site URL* del CRM como está.
5. El proveedor **Azure** ya está configurado para el CRM y el ERP usa el mismo, así que no hay nada que tocar en Microsoft Entra para el login.

> Al compartir el registro de Microsoft con el CRM no se puede limitar en Entra a una sola persona, porque el equipo del CRM lo necesita. Esa limitación la aplica el ERP: proxy → 403, callback → cierra la sesión, y cada página o acción lo vuelve a comprobar.

## 2. Vercel (`er-pclinica`)

**Settings → Environment Variables** → Production:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | la misma URL que el CRM |
| `SUPABASE_PUBLISHABLE_KEY` | la misma *publishable key* que el CRM (sin prefijo NEXT_PUBLIC_: el equipo de Vercel obliga a que todas las variables sean secretas) |
| `SUPABASE_SECRET_KEY` | la clave secreta **`erp`** del paso 1.3 (*Sensitive*) |
| `ANTHROPIC_API_KEY` | clave de la API de Anthropic (*Sensitive*) |

Borra las variables `VITE_*` que quedaban del ERP anterior. Después: **Deployments → ⋯ → Redeploy**.

## 3. Copias de seguridad

El plan gratuito de Supabase no guarda copias que puedas descargar. Lo que te protege son los Excel del gestor (versionados) y los ficheros originales, que se guardan en `erp-documentos`. Más adelante añadiremos una exportación completa periódica.

## 4. Repositorio de facturas (opcional, OneDrive de info@)

El ERP lee la carpeta con el **mínimo permiso**: info@ la comparte en solo lectura con admin@, y el ERP usa la sesión de admin@. No hay un permiso de aplicación que dé acceso a los archivos de todo el tenant.

1. **Compartir la carpeta**, desde la cuenta info@: en OneDrive web, sobre `Clínica Carmen Fontes/01. Contabilidad/01. Facturas` → *Compartir* → *Personas específicas* → `admin@clinicacarmenfontes.com` → **Puede ver** → *Copiar vínculo*. Ese vínculo es `ONEDRIVE_FOLDER_URL`.
2. **Permiso en Entra**, en el registro de aplicación que usa el proveedor Azure de Supabase (el del CRM) → *API permissions* → *Add* → Microsoft Graph → **Delegated** → `Files.Read.All` y `offline_access`. Es delegado: solo da acceso a lo que admin@ ya puede ver, es decir, a esa carpeta.
3. **Variables en Vercel**, en Production:

   | Variable | Valor |
   |---|---|
   | `MS_TENANT_ID` / `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | los mismos del proveedor Azure de Supabase |
   | `TOKEN_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` (*Sensitive*) |
   | `ONEDRIVE_FOLDER_URL` | el vínculo del paso 1 |
   | `REPOSITORY_FROM_YEAR` | `2026` |

4. Redespliega, **cierra sesión y vuelve a entrar** (Microsoft pedirá aceptar el acceso de lectura) → *Repositorio* → **Actualizar listado**. Esto solo lista los ficheros, sin coste.
5. Marca las facturas que quieras leer (normalmente las de doctoras del trimestre) → **Leer con Claude**. Nada se lee automáticamente.

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
pnpm test                    # 68 tests: BBDD (PGlite), convivencia con el CRM, parsers, carga real y repositorio
```

Los tests con ficheros reales de 3T2026 leen `tests/fixtures/private/`. Esa carpeta no va al repositorio, y sin ella esos tests se saltan.
