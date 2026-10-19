# ERP Contable · Clínica Carmen Fontes — Arquitectura

App interna de contabilidad y analítica para **Dental Fontes Lluch SLP (B67717082)**.
Mismo stack, marca y forma de trabajar que el CRM (`10. CRM/crm-carmen-fontes`).
Dominio: **erp.clinicacarmenfontes.com** · Acceso: solo `admin@clinicacarmenfontes.com`.

## Estructura de carpetas

```
erp-carmen-fontes/
├─ src/
│  ├─ proxy.ts                         # Next 16 (antes middleware.ts): sesión + email === admin@ → si no, 403 (lógica en lib/supabase/proxy.ts)
│  ├─ app/
│  │  ├─ layout.tsx / globals.css      # tokens de marca del CRM (Montserrat + Nunito Sans, #B87C7C…)
│  │  ├─ login/page.tsx                # botón "Iniciar sesión con Microsoft"
│  │  ├─ auth/callback/route.ts        # segunda barrera: email exacto, si no → signOut + 403
│  │  ├─ dashboard/
│  │  │  ├─ layout.tsx                 # sidebar oscura con logo (igual que el CRM)
│  │  │  ├─ page.tsx                   # KPIs, Ingresos vs Gastos, últimos movimientos, alertas, "Sincronizar Gestión"
│  │  │  ├─ ingresos/  gastos/         # tablas filtrables + detalle de factura
│  │  │  ├─ contabilidad/              # Diario, Mayor, Balance, P&G
│  │  │  ├─ tesoreria/                 # cashflow proyectado + conciliación
│  │  │  ├─ fiscal/                    # 303 / 111 / 115 en vivo, cierre de trimestre, Excel del gestor
│  │  │  ├─ sincronizacion/            # historial de ejecuciones + conflictos a resolver
│  │  │  └─ configuracion/             # plan de cuentas, tipos de gasto, recurrentes, nóminas
│  │  └─ api/
│  │     ├─ sync/route.ts              # POST: lanza la sincronización (botón)
│  │     ├─ sync/[runId]/route.ts      # GET: progreso
│  │     ├─ export/[period]/route.ts   # .xlsx trimestral
│  │     └─ cron/expense-intel/route.ts# diario: recurrencias + alertas (CRON_SECRET)
│  ├─ lib/
│  │  ├─ auth/allowlist.ts             # ÚNICO email permitido, fijado en código (sin variable de entorno que lo amplíe)
│  │  ├─ auth/session.ts               # requireAdmin()/requireAdminPage(): 3.ª barrera en cada página, acción y ruta
│  │  ├─ db/                           # cliente Supabase de servidor (clave secreta) + tipos generados
│  │  ├─ ingest/
│  │  │  ├─ normalize.ts               # NIF, nº factura, importes (paridad exacta con las funciones SQL)
│  │  │  ├─ dedup-hash.ts              # mismo SHA-256 que invoice_dedup_hash() → precomprobación
│  │  │  ├─ group-lines.ts             # filas por tipo de IVA → 1 factura con N líneas
│  │  │  ├─ pipeline.ts                # parse → normalizar → agrupar → fn_ingest_invoice (insert | merge | conflicto)
│  │  │  └─ parsers/                   # pdf.ts (pdf.js con coordenadas), optimydent-table/optimydent (port de pdf_tables.py), banks (Kutxabank PDF, CaixaBank CSV)
│  │  ├─ rpa/optimydent.ts             # Playwright: login + exportar los 4 listados
│  │  ├─ accounting/                   # reglas de asiento por tipo de documento, lecturas de Mayor/Balance
│  │  ├─ fiscal/                       # modelo-303.ts (con prorrata), modelo-111.ts, modelo-115.ts
│  │  ├─ export/gestor-xlsx.ts         # réplica del excel.py actual (mismas pestañas/columnas/fórmulas)
│  │  ├─ ai/                           # cliente Anthropic, clasificación, recurrencia, anomalías
│  │  └─ format.ts / madrid-time.ts    # copiados del CRM
│  └─ components/
│     ├─ ui/                           # shadcn (copiados del CRM, mismo estilo radix-nova)
│     ├─ layout/  dashboard/  charts/  # KpiCard, StackedIncomeExpense, CashflowArea, StatusBadge…
├─ supabase/migrations/                # SQL = fuente de verdad (triggers de inmutabilidad)
├─ tests/                              # vitest + PGlite (igual que el CRM) con fixtures reales de 3T2026
├─ docs/
└─ vercel.json                         # crons
```

## Lo que aporta lo ya hecho en local

| Origen | Se reutiliza para |
|---|---|
| `04. Claude - Contabilidad auto/App` (Python) | Reglas de validación (`validar.py`), lógica de facturas de doctoras con retención 15 %, formato exacto del Excel del gestor (`excel.py`) y los datos de 3T2026 como tests de regresión |
| `2. ERP Contable/Estructuras Base/DOC ERP/*.csv` | Plan de cuentas, diccionario de 65 tipos de gasto → cuenta PGC, tesorería (570/572/572.1), amortizaciones |
| `Optimydent_ERP/database/0001` | Idea de Diario inmutable + función única de posteo; aquí se endurece (triggers, cadena de hashes, cuadre al COMMIT) |

## Canales de entrada (todos al mismo pipeline antiduplicados)

| Canal | Qué entra | Cómo |
|---|---|---|
| **A · Ficheros de Optimydent** | Facturas emitidas, gastos, saldos acreedores y deudores (Excel o PDF) | Arrastrar a la app. Se reconoce el tipo por contenido, como la app local |
| **B · Repositorio de facturas** | Facturas sueltas en PDF o imagen (doctoras, facturas a clínicas, justificantes) | Subida múltiple → Claude (visión) extrae los campos → bandeja de revisión → contabilizar o vincular como justificante |
| **C · RPA "Sincronizar Gestión"** | Lo mismo que A, sin descargar nada | Login en Optimydent y lectura de los JSON `get-data` que alimentan sus tablas (técnica ya probada en OptiDev). Primero se intenta por HTTP con la cookie de sesión (cabe en una función de Vercel); si Optimydent lo impide, Playwright en Vercel Sandbox |
| **Bancos** | Movimientos de Kutxabank y CaixaBank | Kutxabank: PDF "Movimientos de cuenta" (trae el nº de cuenta). CaixaBank: CSV de CaixaBankNow. Cada fila se valida contra el saldo anterior (si una no cuadra, se rechaza el fichero). Conciliación en cada cierre trimestral |

Los KPIs se calculan siempre con lo cargado y muestran **"datos hasta…" por fuente** (`v_data_freshness`).
Así puedes actualizar cada semana, cada mes o cada trimestre sin que los números engañen: el aviso de
"facturas recurrentes que faltan" solo salta en meses cuyos gastos ya están cargados.

## Información fiscal

- **Trimestral**: 303 (con prorrata), 111 (profesionales + trabajadores desde nóminas), 115, y el Excel del gestor.
- **Anual**: 390, 190, 180, borrador del 347 (terceros por encima de 3.005,06 €, desglosado por trimestre; criterios a validar con el gestor), P&G y balance del ejercicio, y el Excel anual.

## Decisiones de diseño (esquema `supabase/migrations/20261018000001_core_schema.sql`)

1. **Clave antiduplicados** = SHA-256 de `NIF emisor | Nº factura | Fecha | Total`, calculada por trigger.
   - Optimydent exporta una factura con varios tipos de IVA como varias filas → se agrupan en 1 factura con N líneas y el hash usa el total agregado (si no, el hash daría dos facturas distintas o descartaría una línea buena).
   - Proveedor sin CIF (p. ej. *Vistaprint B.V*) → se usa el nombre normalizado.
   - Factura sin número → el pipeline genera `SN-AAAAMMDD-<total>` y la marca para revisión.
2. **Segunda barrera**: `UNIQUE (dirección, emisor, nº, ejercicio)`. Si llega la misma factura con otro importe o fecha, **no se inserta**: va a `ingest_conflicts` para que decidas.
   - Cargos **sin nº** (Optimydent pone "-", p. ej. seguros mensuales): no aplica la segunda barrera; cada cargo entra como registro propio (la huella ya los distingue por fecha/importe) marcado `sin_numero`.
   - **Mantener ambas**: tercera salida del conflicto para dos facturas distintas con el mismo nº. Las dos quedan vivas con `shares_number`, marcadas `numero_factura_repetido` y con nota cruzada. Luego se anulan (`fn_void_invoice`), se corrige su nº/fecha (`fn_correct_invoice_identity`) o se dan por revisadas (`fn_mark_invoice_reviewed`) desde el menú de cada factura.
3. **Merge**: solo cambian `status`, `paid_amount`, `paid_at`, `due_date` y la categoría; cada cambio de estado queda en `invoice_status_history`. *Atrasado* no se guarda: se deriva de `due_date` en `v_invoices`.
   - Además se **completan datos vacíos** (nunca se pisan): descripción de las líneas (concepto) y código postal de la contrapartida (`fn_fill_invoice_gaps`, resultado `completada`).
4. **Inmutabilidad real en BBDD**: Diario, líneas, documentos origen, extractos y auditoría rechazan UPDATE/DELETE/TRUNCATE. Partida doble comprobada al COMMIT. Cadena de hashes verificable con `verify_journal_chain()`.
5. **Cierre de trimestre** (`tax_periods`): tras entregar al gestor, no se pueden dar de alta ni reclasificar facturas de ese trimestre; sí registrar cobros/pagos posteriores.
6. **Saldos de pacientes**: fotos fechadas (`balance_snapshots`), no facturas.
7. **Prorrata de IVA** en `company_settings`: casi todo está exento (art. 20 LIVA) pero medicina estética no.
8. **Nóminas** (`payroll_months`): no salen de Optimydent; las aporta el gestor y alimentan el P&G y el 111 de trabajadores.
9. **RLS sin políticas** en todo: solo el servidor (clave secreta) lee y escribe.
10. **Edición**: matriz completa en [`procedimientos-edicion.md`](procedimientos-edicion.md). La base de datos exige motivo para anular o reabrir, bloquea cualquier cambio en facturas anuladas y deja las anuladas como "lápida" para que un dato erróneo no vuelva a entrar.
11. **Auth y BBDD**: el mismo proyecto Supabase que el CRM (el plan gratuito permite 2 proyectos), en el esquema `erp`. Los usuarios del CRM no tienen permisos sobre él, el ERP tiene su propia clave secreta y el login de Microsoft es compartido. Lo comprueba `tests/coexistence-crm.test.ts`.
12. **Listados de Optimydent en Excel** (`parsers/xlsx.ts`, sin dependencias): es el formato recomendado, porque el PDF corta las columnas que no caben en el A4. El PDF se sigue admitiendo. Las columnas se eligen a mano al exportar, así que se localizan por nombre (orden libre) y las que no van a BBDD se ignoran (el nº de historia tampoco se lee). Las imprescindibles para la contabilidad (identidad de la factura, importes, IVA, tipo de gasto, fecha de pago, NIF) son obligatorias y su ausencia rechaza el fichero; si falta una secundaria se avisa, se deja vacía y se puede volver a subir el listado con ella para completarla. Detalle en `SPEC_*` de `src/lib/ingest/parsers/optimydent.ts`.

Probado en PGlite: duplicado exacto, mismo nº con otro importe, líneas descuadradas, total ≠ base + IVA, cambio de importe, borrado, asiento descuadrado, UPDATE/DELETE/TRUNCATE del Diario, cadena manipulada y alta en trimestre cerrado → **todo bloqueado**; merge Pendiente → Pagada → registrado en historial.

## Estado

| Paso | Estado |
|---|---|
| 1. Estructura y esquema | ✅ validado |
| 2. Auth admin-only + layout con la marca del CRM | ✅ proxy (403), callback y `requireAdmin` en cada página/acción |
| 3a. Ingesta de ficheros (Optimydent PDF, Kutxabank PDF, CaixaBank CSV) | ✅ migración 0002, parsers y pantalla de Sincronización. Cuadra al céntimo con el Excel entregado de 3T2026 |
| 3b. Repositorio de facturas (OneDrive de info@ + lectura con Claude) | ✅ código y tests (migración 0003). Falta conectarlo: compartir la carpeta, añadir el permiso en Entra y configurar las variables |
| 3c. RPA "Sincronizar Gestión" | pendiente |
| 4. Motor de recurrencia/anomalías (Claude) | pendiente |
| 5. Dashboard, contabilización, fiscal y Excel del gestor | Resumen completo (KPIs mes/año, Ingresos vs Gastos, cashflow 13 semanas, avisos de recurrentes por reglas, últimos movimientos), Revisión, Fiscal (303 con prorrata, 111, 115, 347, cierre/reapertura), **Excel del gestor** (réplica de `excel.py`, verificado celda a celda al generarlo y con regresión contra el entregado del 3T2026), Nóminas y rentabilidad (margen, EBITDA, Carmen Fontes) ✅ · contabilización y facturación por tratamiento pendientes |

Notas de la ingesta real de 3T2026:
- El PDF de Gastos corta la última columna ("Asiento contable") en el borde del A4. La cuenta se toma del **tipo de gasto**, no de esa columna.
- Optimydent tiene grabados proveedores con el CIF de la clínica (DentalMonitoring). Salen marcados `nif_emisor_es_la_clinica`, y lo correcto es arreglar la ficha del proveedor en Optimydent.
- Un proveedor reutiliza el mismo nº de factura en meses distintos (OPTO2026/1013). Llega como **conflicto** para decidir, nunca se sobrescribe solo.
- Las 4 líneas que se excluyeron a mano en la app local salen marcadas (línea repetida) o se descartan con "Corregir/Anular" con motivo.

### Repositorio (OneDrive de info@)

- **Acceso.** Delegado: info@ comparte «01. Facturas» con admin@ en solo lectura, y el ERP usa la sesión de admin@ con `Files.Read.All` delegado y `offline_access`. El refresh token se guarda cifrado con AES-256-GCM (`integration_tokens`). La carpeta se resuelve con el vínculo compartido (`/shares/u!…`).
- **Rol por carpeta** (`src/lib/repository/paths.ts`):
  - PICADAS y "metidas en el programa" → justificante de un registro de Optimydent;
  - raíz del trimestre → aún sin picar;
  - "Facturas con retención" → doctora;
  - "Facturas emitidas SLP" → emitida;
  - transferencias, zip y xlsx → ignorados.
- **Lectura.** Claude con salida estructurada (zod). Después, `buildDraft` valida la aritmética en céntimos y marca lo que no cuadra.
- **Emparejamiento** (`fn_match_extraction`). Compara el nº de factura solo por letras y cifras, el total, la fecha y el emisor, que no es imprescindible por los CIF erróneos de Optimydent. Solo vincula sola cuando la coincidencia es inequívoca: puntuación ≥ 0,8 y sin otra candidata a menos de 0,2.
- **Rematch.** Al subir el listado de gastos de Optimydent, las lecturas pendientes se vuelven a emparejar.
- **Control inverso.** `v_invoices_without_receipt`: gastos de Optimydent que no tienen su PDF en OneDrive.

### Excel del gestor

- Datos: `erp.fn_gestor_export_data(año, trimestre)` (la misma función en la app y en los tests). Modelo y controles: `src/lib/gestor/model.ts` (réplica de `validar.py`); escritura: `src/lib/gestor/xlsx.ts` (réplica de `excel.py`); verificación al generar: `src/lib/gestor/verify.ts`.
- Regresión `tests/gestor-3T2026.test.ts`: PDF reales → BBDD → mismas correcciones que en la app anterior hechas con las herramientas del ERP → el Excel coincide fila a fila con el entregado (`v2`). Diferencias intencionadas: NIF sin guiones y CP inválido vacío.
- Los datos salen tal como figuran en cada documento: `invoices.bill_to_*` (facturación de cada factura emitida) y una línea por paciente en `balance_snapshot_lines` con sus datos.
