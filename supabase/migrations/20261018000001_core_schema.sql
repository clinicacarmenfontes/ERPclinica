-- ═══════════════════════════════════════════════════════════════════════════
-- ERP Contable Clínica Carmen Fontes (Dental Fontes Lluch SLP · B67717082)
-- Esquema núcleo — Paso 1 (pendiente de validación)
--
-- Vive en el esquema `erp` del proyecto Supabase del CRM (plan gratuito: máx.
-- 2 proyectos). No toca nada de `public` (CRM) y el CRM no ve nada de `erp`.
--
-- Modelo de acceso: la app tiene UN solo usuario (admin@clinicacarmenfontes.com)
-- y TODO el acceso a la BBDD pasa por el servidor (Server Components / Route
-- Handlers) con la clave secreta. RLS activado en todas las tablas y SIN
-- políticas: anon/authenticated no pueden leer ni escribir nada aunque se
-- filtrara la clave publicable. El control de identidad vive en src/proxy.ts.
--
-- Garantías contables que da la propia BBDD (no dependen del código de la app):
--   1. Libro Diario inmutable: UPDATE/DELETE/TRUNCATE prohibidos por trigger;
--      los errores se corrigen con un asiento de rectificación (reverses_entry_id).
--   2. Partida doble: Debe = Haber por asiento, comprobado al hacer COMMIT.
--   3. Cadena de hashes (chain_hash) sobre el Diario: cualquier manipulación
--      directa en la BBDD rompe la cadena y fn_verify_journal_chain() lo detecta.
--   4. Antiduplicados: hash SHA-256 de [NIF emisor + Nº factura + Fecha + Total]
--      calculado por trigger (la app no puede enviar uno distinto), UNIQUE.
--   5. Importes de factura inmutables: solo cambian estado/pago/categoría.
--   6. Trimestre cerrado (presentado al gestor) = bloqueado para altas y cambios.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists erp;
-- Las tablas nuevas del esquema solo para el servidor (nunca anon/authenticated).
alter default privileges in schema erp revoke all on tables from public, anon, authenticated;
alter default privileges in schema erp revoke execute on functions from public, anon, authenticated;

-- ── Utilidades ─────────────────────────────────────────────────────────────
create or replace function erp.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Prohíbe UPDATE/DELETE en tablas append-only (Diario, auditoría, documentos).
create or replace function erp.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% es inmutable: corrige con un asiento/registro de rectificación', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- '52683874 m' / 'B-67717082' → '52683874M' / 'B67717082'. NULL si queda vacío.
create or replace function erp.norm_tax_id(p text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

-- Nombre normalizado para terceros sin NIF (p. ej. 'Vistaprint B.V').
create or replace function erp.norm_name(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

-- ── Configuración de la sociedad (una sola fila) ──────────────────────────
create table erp.company_settings (
  id boolean primary key default true check (id),
  legal_name text not null,
  tax_id text not null,
  -- Prorrata de IVA: la asistencia sanitaria está exenta (art. 20 LIVA), pero
  -- medicina estética no. Solo el % deducible del IVA soportado va al 303.
  vat_prorrata_pct numeric(5, 2) not null default 0 check (vat_prorrata_pct between 0 and 100),
  -- Día del mes a partir del cual se avisa de facturas recurrentes no recibidas.
  missing_invoice_alert_day smallint not null default 28 check (missing_invoice_alert_day between 1 and 31),
  updated_at timestamptz not null default now()
);

create trigger company_settings_set_updated_at
  before update on erp.company_settings
  for each row execute function erp.set_updated_at();

insert into erp.company_settings (legal_name, tax_id)
values ('Dental Fontes Lluch SLP', 'B67717082');

-- ── Plan de cuentas (PGC, códigos de 8 dígitos como en Optimydent) ─────────
create table erp.accounts (
  code text primary key check (code ~ '^\d{3,8}(\.[A-Z0-9]+)?$'),
  name text not null,
  kind text not null check (kind in ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
  nature text not null check (nature in ('deudora', 'acreedora')),
  parent_code text references erp.accounts (code),
  -- Subcuenta de tercero (4300.<id>, 4000.<id>): se crea al contabilizar.
  is_auxiliary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index accounts_parent_idx on erp.accounts (parent_code);

-- ── Partidas analíticas (vista gerencial, estilo Holded) ──────────────────
create table erp.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#B87C7C',
  position smallint not null,
  created_at timestamptz not null default now()
);

insert into erp.expense_categories (name, color, position) values
  ('Clínico',               '#B87C7C', 1),  -- material, laboratorio
  ('Personal',              '#7C93B8', 2),  -- nóminas, SS, doctoras con retención, formación
  ('Alquiler y local',      '#D1B7A1', 3),  -- alquiler, comunidad, mantenimiento, alarmas
  ('Suministros',           '#6FA88A', 4),  -- luz, agua, telecomunicaciones
  ('Marketing',             '#D4B2A7', 5),
  ('Software',              '#8E7CB8', 6),
  ('Servicios externos',    '#A8A39A', 7),  -- gestoría, abogados, seguros
  ('Financiero e impuestos','#6B6763', 8),  -- comisiones, intereses, IBI, tasas
  ('Inversión',             '#45453F', 9);  -- compras que van a inmovilizado (21x)

-- ── Tipos de gasto de Optimydent → cuenta PGC + partida ───────────────────
-- Fuente: Estructuras Base/DOC ERP/diccionario_tipos_gasto.csv (65 tipos).
-- Se siembra en la migración 0002. Un tipo nuevo que llegue del RPA se da de
-- alta sin cuenta y lo clasifica la IA (queda marcado para revisión).
create table erp.expense_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                       -- tal cual viene de Optimydent
  account_code text references erp.accounts (code),
  category_id uuid references erp.expense_categories (id),
  behavior text check (behavior in ('fijo', 'variable')),
  -- Modelo de retención que genera este gasto (alquiler → 115, profesionales → 111).
  withholding_model text check (withholding_model in ('111', '115')),
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── Terceros: pacientes, proveedores, profesionales, clínicas ──────────────
create table erp.parties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('paciente', 'proveedor', 'profesional', 'cliente')),
  tax_id text,                                      -- normalizado (norm_tax_id)
  name text not null,
  -- Clave de identidad: el NIF si lo hay; si no, el nombre normalizado.
  party_key text generated always as (
    coalesce(erp.norm_tax_id(tax_id), 'N:' || erp.norm_name(name))
  ) stored,
  clinical_record text,                             -- Nº historia (pacientes Optimydent)
  phone text,
  postal_code text,
  default_withholding_rate numeric(5, 4) check (default_withholding_rate between 0 and 1),
  default_payment_days smallint not null default 0,
  default_expense_type_id uuid references erp.expense_types (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, party_key)
);

create index parties_tax_id_idx on erp.parties (tax_id);

create trigger parties_set_updated_at
  before update on erp.parties
  for each row execute function erp.set_updated_at();

-- ── Trimestres fiscales: cierre = bloqueo ──────────────────────────────────
create table erp.tax_periods (
  year smallint not null,
  quarter smallint not null check (quarter between 1 and 4),
  status text not null default 'abierto' check (status in ('abierto', 'cerrado')),
  closed_at timestamptz,
  closed_by text,
  primary key (year, quarter)
);

create or replace function erp.assert_period_open(p_date date)
returns void
language plpgsql
stable
as $$
begin
  if exists (
    select 1 from erp.tax_periods
    where year = extract(year from p_date)
      and quarter = extract(quarter from p_date)
      and status = 'cerrado'
  ) then
    raise exception 'El trimestre %T % está cerrado: no admite cambios',
      extract(quarter from p_date), extract(year from p_date)
      using errcode = 'P0002';
  end if;
end;
$$;

-- Historial de cierres/reaperturas: reabrir exige motivo y deja traza.
create table erp.tax_period_events (
  id bigint generated always as identity primary key,
  year smallint not null,
  quarter smallint not null,
  action text not null check (action in ('cerrado', 'reabierto')),
  reason text,
  actor text not null,
  created_at timestamptz not null default now(),
  foreign key (year, quarter) references erp.tax_periods (year, quarter),
  check (action = 'cerrado' or length(trim(coalesce(reason, ''))) >= 10)
);

-- ── Pipeline de ingesta ─────────────────────────────────────────────────────
-- Tres canales, un solo pipeline: todos producen el mismo "documento
-- normalizado" y pasan por el mismo filtro antiduplicados.
--   optimydent_rpa       → botón "Sincronizar Gestión" (login + endpoints JSON)
--   optimydent_fichero   → subes los Excel/PDF exportados de Optimydent
--   repositorio          → facturas sueltas (PDF/imagen) leídas con Claude
--   banco                → Excel de movimientos de Kutxabank / CaixaBank
create table erp.sync_runs (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('optimydent_rpa', 'optimydent_fichero', 'repositorio', 'banco')),
  trigger text not null check (trigger in ('boton', 'cron', 'subida_manual')),
  status text not null default 'en_curso'
    check (status in ('en_curso', 'completado', 'completado_con_avisos', 'fallido')),
  period_from date,
  period_to date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- {"insertadas":n,"actualizadas":n,"sin_cambios":n,"duplicadas":n,"conflictos":n}
  stats jsonb not null default '{}'::jsonb,
  error text,
  triggered_by text not null
);

-- Solo una sincronización a la vez (evita carreras entre botón y cron).
create unique index sync_runs_one_running_idx on erp.sync_runs ((true)) where status = 'en_curso';

-- Ficheros originales (Storage): descargados por el RPA o subidos a mano.
-- El RPA guarda también el JSON crudo que devolvió Optimydent, para poder
-- reprocesar o auditar sin volver a entrar.
create table erp.source_documents (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid references erp.sync_runs (id),
  kind text not null check (kind in (
    'optimydent_facturas_emitidas', 'optimydent_gastos', 'optimydent_saldos_acreedores',
    'optimydent_saldos_deudores', 'optimydent_cobros',
    'factura_profesional', 'factura_emitida', 'factura_recibida',   -- repositorio (PDF/imagen)
    'movimientos_banco'
  )),
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  sha256 text not null unique,                      -- el mismo fichero no se procesa dos veces
  byte_size integer not null,
  -- Rango de fechas que cubre el fichero (lo calcula el parser). Alimenta la
  -- "frescura" de los KPIs y evita falsas alertas de facturas que faltan.
  covers_from date,
  covers_to date,
  created_at timestamptz not null default now()
);

create trigger source_documents_immutable
  before update or delete on erp.source_documents
  for each row execute function erp.forbid_mutation();

-- Lectura de cada documento del repositorio (Claude visión / parser). Es la
-- capa editable: aquí corriges lo que la IA leyó mal ANTES de contabilizar.
create table erp.document_extractions (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null unique references erp.source_documents (id),
  status text not null default 'pendiente' check (status in (
    'pendiente',      -- leído, esperando tu revisión
    'vinculado',      -- coincide con una factura ya existente (p. ej. ya venía de Optimydent): queda como justificante
    'contabilizado',  -- se creó una factura nueva a partir de él
    'descartado'      -- no es una factura / duplicado / ilegible
  )),
  extracted jsonb not null,                         -- lo que leyó la IA (inmutable de facto)
  corrected jsonb,                                  -- tus correcciones campo a campo
  confidence numeric(3, 2),
  model text,
  matched_invoice_id uuid,                          -- FK tras crear invoices
  created_invoice_id uuid,
  discard_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'descartado' or discard_reason is not null)
);

-- ── Facturas (emitidas y recibidas) ─────────────────────────────────────────
create table erp.invoices (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('emitida', 'recibida')),

  -- Identidad fiscal (inmutable) ------------------------------------------
  issuer_tax_id text,                               -- emitidas: CIF de la clínica
  issuer_name text not null,
  issuer_key text generated always as (
    coalesce(erp.norm_tax_id(issuer_tax_id), 'N:' || erp.norm_name(issuer_name))
  ) stored,
  invoice_number text not null,
  invoice_number_norm text generated always as (upper(regexp_replace(invoice_number, '\s', '', 'g'))) stored,
  issue_date date not null,
  fiscal_year smallint generated always as (extract(year from issue_date)::smallint) stored,
  counterparty_id uuid not null references erp.parties (id),

  -- Importes (inmutables). total = base + IVA − retención = lo que se cobra/paga.
  base_total numeric(14, 2) not null,
  vat_total numeric(14, 2) not null default 0,
  withholding_total numeric(14, 2) not null default 0 check (withholding_total >= 0),
  total numeric(14, 2) not null,

  -- SHA-256 de [issuer_key | nº factura | fecha | total]. Lo fija el trigger.
  -- Único entre las no anuladas; las anuladas quedan como "lápida": si el
  -- origen vuelve a mandar el dato erróneo, el pipeline lo reconoce y lo ignora.
  dedup_hash text not null,

  -- Estado (mutable vía merge del RPA o a mano) ----------------------------
  status text not null default 'pendiente' check (status in ('pendiente', 'parcial', 'pagada', 'anulada')),
  due_date date,
  paid_amount numeric(14, 2) not null default 0,
  paid_at date,
  payment_method text,

  -- Analítica (mutable) -----------------------------------------------------
  expense_type_id uuid references erp.expense_types (id),
  category_id uuid references erp.expense_categories (id),
  category_source text check (category_source in ('regla', 'ia', 'manual')),
  ai_confidence numeric(3, 2) check (ai_confidence between 0 and 1),

  -- Trazabilidad -------------------------------------------------------------
  source text not null check (source in ('optimydent', 'pdf_profesional', 'pdf_emitida', 'manual')),
  source_document_id uuid references erp.source_documents (id),
  first_sync_run_id uuid references erp.sync_runs (id),
  last_sync_run_id uuid references erp.sync_runs (id),
  journal_entry_id uuid,                            -- FK añadida tras crear journal_entries
  notes text,

  -- Edición y corrección ---------------------------------------------------
  -- Campos que has cambiado a mano: la sincronización NUNCA los sobrescribe.
  manual_fields text[] not null default '{}',
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',     -- 'tipo_gasto_nuevo', 'sin_numero', 'ia_baja_confianza'…
  -- Corrección de datos fiscales = anular + crear la buena enlazada.
  corrects_invoice_id uuid references erp.invoices (id),
  void_reason text,
  voided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_total_cuadra check (base_total + vat_total - withholding_total = total),
  constraint invoices_paid_coherente check (
    (status = 'pagada' and paid_at is not null) or status <> 'pagada'
  ),
  constraint invoices_void_coherente check (
    (status = 'anulada') = (void_reason is not null and voided_at is not null)
  )
);

create unique index invoices_dedup_hash_live_idx on erp.invoices (dedup_hash) where status <> 'anulada';
-- Segunda barrera: mismo emisor + nº + ejercicio con distinto importe/fecha
-- NO entra como factura nueva; el pipeline lo manda a ingest_conflicts.
create unique index invoices_natural_key_live_idx on erp.invoices
  (direction, issuer_key, invoice_number_norm, fiscal_year) where status <> 'anulada';
create index invoices_dedup_hash_idx on erp.invoices (dedup_hash);
create index invoices_review_idx on erp.invoices (created_at) where needs_review;

create index invoices_issue_date_idx on erp.invoices (issue_date);
create index invoices_counterparty_idx on erp.invoices (counterparty_id);
create index invoices_open_due_idx on erp.invoices (due_date) where status in ('pendiente', 'parcial');
create index invoices_category_idx on erp.invoices (category_id);

create or replace function erp.invoice_dedup_hash(
  p_issuer_key text, p_number text, p_date date, p_total numeric
) returns text
language sql
stable
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_issuer_key,
    upper(regexp_replace(p_number, '\s', '', 'g')),
    to_char(p_date, 'YYYY-MM-DD'),
    to_char(round(p_total, 2), 'FM999999999990.00')
  ), 'UTF8')), 'hex');
$$;

create or replace function erp.invoices_before_write()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform erp.assert_period_open(new.issue_date);
    new.dedup_hash := erp.invoice_dedup_hash(
      coalesce(erp.norm_tax_id(new.issuer_tax_id), 'N:' || erp.norm_name(new.issuer_name)),
      new.invoice_number, new.issue_date, new.total);
    return new;
  end if;

  -- UPDATE: identidad e importes no se tocan nunca.
  if (new.direction, new.issuer_tax_id, new.issuer_name, new.invoice_number, new.issue_date,
      new.counterparty_id, new.base_total, new.vat_total, new.withholding_total, new.total,
      new.dedup_hash, new.source, new.source_document_id, new.first_sync_run_id)
     is distinct from
     (old.direction, old.issuer_tax_id, old.issuer_name, old.invoice_number, old.issue_date,
      old.counterparty_id, old.base_total, old.vat_total, old.withholding_total, old.total,
      old.dedup_hash, old.source, old.source_document_id, old.first_sync_run_id) then
    raise exception 'Los datos fiscales e importes de una factura son inmutables (factura %)', old.invoice_number
      using errcode = 'P0001';
  end if;
  if old.journal_entry_id is not null and new.journal_entry_id is distinct from old.journal_entry_id then
    raise exception 'La factura % ya está contabilizada', old.invoice_number using errcode = 'P0001';
  end if;
  if old.status = 'anulada' then
    raise exception 'La factura % está anulada: no admite cambios', old.invoice_number using errcode = 'P0001';
  end if;
  if new.corrects_invoice_id is distinct from old.corrects_invoice_id then
    raise exception 'El enlace de corrección se fija al crear la factura' using errcode = 'P0001';
  end if;
  if new.status = 'anulada' then
    if length(trim(coalesce(new.void_reason, ''))) < 10 then
      raise exception 'Anular una factura exige un motivo (mín. 10 caracteres)' using errcode = 'P0005';
    end if;
    perform erp.assert_period_open(old.issue_date);
    new.voided_at := coalesce(new.voided_at, now());
  end if;
  -- Cobros/pagos de un trimestre cerrado sí se registran (ocurren después);
  -- lo que no se permite es reclasificar un gasto ya entregado al gestor.
  if (new.expense_type_id, new.category_id) is distinct from (old.expense_type_id, old.category_id) then
    perform erp.assert_period_open(old.issue_date);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger invoices_before_insert_update
  before insert or update on erp.invoices
  for each row execute function erp.invoices_before_write();

create trigger invoices_no_delete
  before delete on erp.invoices
  for each row execute function erp.forbid_mutation();

-- Desglose por tipo de IVA / retención. Optimydent exporta una factura con
-- dos tipos (21 % y 10 %) como dos filas: se agrupan en UNA factura con dos
-- líneas, y el hash usa el total agregado.
create table erp.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references erp.invoices (id),
  line_no smallint not null,
  description text,
  base numeric(14, 2) not null,
  vat_rate numeric(5, 4) not null default 0 check (vat_rate between 0 and 1),
  vat_amount numeric(14, 2) not null default 0,
  vat_exempt_reason text,                           -- 'art. 20 LIVA' en asistencia sanitaria
  withholding_rate numeric(5, 4) not null default 0 check (withholding_rate between 0 and 1),
  withholding_amount numeric(14, 2) not null default 0,
  account_code text references erp.accounts (code),
  unique (invoice_id, line_no)
);

create trigger invoice_lines_immutable
  before update or delete on erp.invoice_lines
  for each row execute function erp.forbid_mutation();

-- Las líneas deben sumar la cabecera (se comprueba al COMMIT).
create or replace function erp.check_invoice_lines_sum()
returns trigger
language plpgsql
as $$
declare
  v_inv erp.invoices;
  v record;
begin
  select * into v_inv from erp.invoices where id = new.invoice_id;
  select coalesce(sum(base), 0) as b, coalesce(sum(vat_amount), 0) as i,
         coalesce(sum(withholding_amount), 0) as r
    into v from erp.invoice_lines where invoice_id = new.invoice_id;
  if v.b <> v_inv.base_total or v.i <> v_inv.vat_total or v.r <> v_inv.withholding_total then
    raise exception 'Las líneas de la factura % no cuadran con la cabecera', v_inv.invoice_number
      using errcode = 'P0003';
  end if;
  return null;
end;
$$;

create constraint trigger invoice_lines_sum_check
  after insert on erp.invoice_lines
  deferrable initially deferred
  for each row execute function erp.check_invoice_lines_sum();

-- Justificantes: una factura puede tener varios documentos (el listado de
-- Optimydent donde apareció + la foto/PDF original del repositorio).
create table erp.invoice_documents (
  invoice_id uuid not null references erp.invoices (id),
  source_document_id uuid not null references erp.source_documents (id),
  role text not null check (role in ('listado_origen', 'justificante')),
  created_at timestamptz not null default now(),
  primary key (invoice_id, source_document_id)
);

alter table erp.document_extractions
  add constraint document_extractions_matched_fk foreign key (matched_invoice_id) references erp.invoices (id),
  add constraint document_extractions_created_fk foreign key (created_invoice_id) references erp.invoices (id);

-- Historial de cambios de estado (Pendiente → Pagada…), lo rellena el trigger.
create table erp.invoice_status_history (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references erp.invoices (id),
  from_status text,
  to_status text not null,
  paid_amount numeric(14, 2) not null,
  sync_run_id uuid references erp.sync_runs (id),
  changed_at timestamptz not null default now()
);

create index invoice_status_history_invoice_idx on erp.invoice_status_history (invoice_id);

create or replace function erp.log_invoice_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status or new.paid_amount is distinct from old.paid_amount then
    insert into erp.invoice_status_history (invoice_id, from_status, to_status, paid_amount, sync_run_id)
    values (new.id, old.status, new.status, new.paid_amount, new.last_sync_run_id);
  end if;
  return null;
end;
$$;

create trigger invoices_log_status
  after update on erp.invoices
  for each row execute function erp.log_invoice_status();

create trigger invoice_status_history_immutable
  before update or delete on erp.invoice_status_history
  for each row execute function erp.forbid_mutation();

-- Entrantes que chocan con una factura existente (mismo emisor + nº + año pero
-- distinto importe o fecha). Nunca se insertan solos: los resuelves tú.
create table erp.ingest_conflicts (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references erp.sync_runs (id),
  existing_invoice_id uuid not null references erp.invoices (id),
  incoming jsonb not null,
  differences jsonb not null,                       -- {"total":[1477.69, 1500.00], ...}
  resolution text not null default 'pendiente'
    check (resolution in (
      'pendiente',
      'mantener_existente',     -- el dato bueno es el que ya estaba (se ignora el entrante)
      'sustituir_por_entrante'  -- se anula la existente y se crea la entrante enlazada (corrects_invoice_id)
    )),
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index ingest_conflicts_pending_idx on erp.ingest_conflicts (created_at) where resolution = 'pendiente';

-- ── Saldos de pacientes (deudores / acreedores) — fotos fechadas ────────────
-- Inmutables. Si subes un listado equivocado, se sube el bueno con la misma
-- fecha: manda el más reciente (v_latest_balance_snapshots).
create table erp.balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of date not null,
  side text not null check (side in ('acreedores', 'deudores')),
  sync_run_id uuid references erp.sync_runs (id),
  source_document_id uuid references erp.source_documents (id),
  content_hash text not null,
  total numeric(14, 2) not null,                    -- acreedores > 0 (anticipos) · deudores < 0 (pendiente de cobro)
  patients integer not null,
  created_at timestamptz not null default now(),
  unique (as_of, side, content_hash)
);

create table erp.balance_snapshot_lines (
  snapshot_id uuid not null references erp.balance_snapshots (id),
  party_id uuid not null references erp.parties (id),
  balance numeric(14, 2) not null check (balance <> 0),
  primary key (snapshot_id, party_id)
);

create trigger balance_snapshots_immutable
  before update or delete on erp.balance_snapshots
  for each row execute function erp.forbid_mutation();
create trigger balance_snapshot_lines_immutable
  before update or delete on erp.balance_snapshot_lines
  for each row execute function erp.forbid_mutation();

-- ── Libro Diario (inmutable) ────────────────────────────────────────────────
create table erp.journal_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,   -- orden global (cadena de hashes)
  fiscal_year smallint not null,
  entry_number integer not null,                    -- correlativo por ejercicio, sin huecos
  entry_date date not null,
  description text not null,
  kind text not null check (kind in (
    'apertura', 'factura_emitida', 'factura_recibida', 'cobro', 'pago', 'nomina',
    'amortizacion', 'regularizacion_iva', 'cierre', 'rectificacion', 'manual'
  )),
  source_invoice_id uuid references erp.invoices (id),
  reverses_entry_id uuid unique references erp.journal_entries (id),
  prev_hash text,
  chain_hash text not null unique,
  posted_at timestamptz not null default now(),
  posted_by text not null,
  unique (fiscal_year, entry_number),
  check (fiscal_year = extract(year from entry_date))
);

create index journal_entries_date_idx on erp.journal_entries (entry_date);

create table erp.journal_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references erp.journal_entries (id),
  line_no smallint not null,
  account_code text not null references erp.accounts (code),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  party_id uuid references erp.parties (id),
  description text,
  unique (entry_id, line_no),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index journal_lines_account_idx on erp.journal_lines (account_code);
create index journal_lines_party_idx on erp.journal_lines (party_id);

alter table erp.invoices
  add constraint invoices_journal_entry_fk foreign key (journal_entry_id) references erp.journal_entries (id);

create trigger journal_entries_immutable
  before update or delete on erp.journal_entries
  for each row execute function erp.forbid_mutation();
create trigger journal_lines_immutable
  before update or delete on erp.journal_lines
  for each row execute function erp.forbid_mutation();

create or replace function erp.forbid_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception '% no se puede vaciar', tg_table_name using errcode = 'P0001';
end;
$$;

create trigger journal_entries_no_truncate before truncate on erp.journal_entries
  for each statement execute function erp.forbid_truncate();
create trigger journal_lines_no_truncate before truncate on erp.journal_lines
  for each statement execute function erp.forbid_truncate();
create trigger invoices_no_truncate before truncate on erp.invoices
  for each statement execute function erp.forbid_truncate();

-- Partida doble comprobada al COMMIT (un asiento descuadrado aborta la transacción).
create or replace function erp.check_entry_balanced()
returns trigger
language plpgsql
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*)
    into v_debit, v_credit, v_lines
    from erp.journal_lines where entry_id = new.entry_id;
  if v_lines < 2 or v_debit <> v_credit then
    raise exception 'Asiento descuadrado: Debe % ≠ Haber % (% líneas)', v_debit, v_credit, v_lines
      using errcode = 'P0004';
  end if;
  return null;
end;
$$;

create constraint trigger journal_lines_balanced
  after insert on erp.journal_lines
  deferrable initially deferred
  for each row execute function erp.check_entry_balanced();

-- Representación canónica de un asiento para la cadena de hashes.
create or replace function erp.journal_entry_canonical(p_entry_id uuid)
returns text
language sql
stable
as $$
  select concat_ws('|',
    e.fiscal_year, e.entry_number, to_char(e.entry_date, 'YYYY-MM-DD'), e.kind, e.description,
    (select string_agg(concat_ws(':', l.line_no, l.account_code,
                                 to_char(l.debit, 'FM999999999990.00'),
                                 to_char(l.credit, 'FM999999999990.00'),
                                 coalesce(l.party_id::text, '')), ';' order by l.line_no)
       from erp.journal_lines l where l.entry_id = e.id))
  from erp.journal_entries e where e.id = p_entry_id;
$$;

-- Recorre el Diario y devuelve el primer asiento cuya cadena no cuadra (o nada).
create or replace function erp.verify_journal_chain()
returns table (seq bigint, entry_id uuid, problem text)
language plpgsql
stable
as $$
declare
  r record;
  v_prev text := null;
begin
  for r in select e.id, e.seq, e.prev_hash, e.chain_hash from erp.journal_entries e order by e.seq loop
    if r.prev_hash is distinct from v_prev then
      seq := r.seq; entry_id := r.id; problem := 'prev_hash no enlaza con el asiento anterior';
      return next; return;
    end if;
    if r.chain_hash <> encode(sha256(convert_to(coalesce(v_prev, '') || '|' ||
                                     erp.journal_entry_canonical(r.id), 'UTF8')), 'hex') then
      seq := r.seq; entry_id := r.id; problem := 'el contenido del asiento ha cambiado';
      return next; return;
    end if;
    v_prev := r.chain_hash;
  end loop;
end;
$$;

-- NOTA: fn_post_journal_entry(jsonb) — única vía de escritura al Diario
-- (numeración correlativa con advisory lock, chain_hash, alta de subcuentas
-- auxiliares) — y fn_ingest_invoice(jsonb) — alta/merge atómico con
-- antiduplicados — van en la migración del Paso 3 (pipeline de ingesta).

-- ── Tesorería y conciliación (trimestral) ──────────────────────────────────
-- Movimientos desde el Excel gratuito de cada banco (no el extracto de pago).
-- Descargas solapadas no duplican: el hash incluye el saldo tras el movimiento.
create table erp.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank text not null check (bank in ('kutxabank', 'caixabank', 'caja')),
  iban text unique,
  account_code text not null references erp.accounts (code),   -- 572xxxxx por banco, 57000000 caja
  created_at timestamptz not null default now()
);

create table erp.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references erp.bank_accounts (id),
  booking_date date not null,
  value_date date,
  amount numeric(14, 2) not null check (amount <> 0),   -- + entrada / − salida
  balance_after numeric(14, 2),                         -- saldo que muestra el banco tras el movimiento
  description text not null,
  counterparty text,
  source text not null check (source in ('excel_banco', 'manual')),
  source_document_id uuid references erp.source_documents (id),
  -- SHA-256 de cuenta|fecha|importe|saldo|concepto (+ nº de orden si el banco no da saldo).
  import_hash text not null unique,
  created_at timestamptz not null default now()
);

create index bank_transactions_date_idx on erp.bank_transactions (booking_date);

create trigger bank_transactions_immutable
  before update or delete on erp.bank_transactions
  for each row execute function erp.forbid_mutation();

create table erp.reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references erp.bank_transactions (id),
  invoice_id uuid not null references erp.invoices (id),
  amount numeric(14, 2) not null check (amount <> 0),
  -- auto_agregado: una liquidación del TPV o de la financiera = muchas facturas.
  method text not null check (method in ('auto_exacto', 'auto_agregado', 'auto_ia', 'manual')),
  confidence numeric(3, 2) check (confidence between 0 and 1),
  status text not null default 'propuesta' check (status in ('propuesta', 'confirmada', 'rechazada')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bank_transaction_id, invoice_id)
);

-- Cerrado el trimestre, las conciliaciones de ese periodo quedan fijas.
create or replace function erp.reconciliations_guard()
returns trigger
language plpgsql
as $$
declare
  v_date date;
begin
  select booking_date into v_date from erp.bank_transactions
   where id = coalesce(new.bank_transaction_id, old.bank_transaction_id);
  perform erp.assert_period_open(v_date);
  return coalesce(new, old);
end;
$$;

create trigger reconciliations_period_guard
  before insert or update or delete on erp.reconciliations
  for each row execute function erp.reconciliations_guard();

-- ── Motor de inteligencia de gastos (Claude) ───────────────────────────────
create table erp.recurring_patterns (
  id uuid primary key default gen_random_uuid(),
  label text not null,                              -- 'Licencias Microsoft 365', 'Alquiler local'
  party_id uuid references erp.parties (id),
  expense_type_id uuid references erp.expense_types (id),
  cadence text not null check (cadence in ('mensual', 'bimestral', 'trimestral', 'anual')),
  expected_day smallint check (expected_day between 1 and 31),
  expected_amount numeric(14, 2),
  amount_tolerance_pct numeric(5, 2) not null default 15,
  detected_by text not null check (detected_by in ('ia', 'manual')),
  confidence numeric(3, 2),
  active boolean not null default true,
  last_seen_invoice_id uuid references erp.invoices (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (party_id, expense_type_id, cadence)
);

create trigger recurring_patterns_set_updated_at
  before update on erp.recurring_patterns
  for each row execute function erp.set_updated_at();

create table erp.expense_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'factura_faltante', 'importe_anomalo', 'posible_duplicado', 'tipo_nuevo', 'datos_desactualizados'
  )),
  period text not null check (period ~ '^\d{4}-\d{2}$'),   -- '2026-10'
  pattern_id uuid references erp.recurring_patterns (id),
  invoice_id uuid references erp.invoices (id),
  severity text not null default 'aviso' check (severity in ('info', 'aviso', 'critico')),
  message text not null,
  status text not null default 'abierta' check (status in ('abierta', 'resuelta', 'descartada')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- La evaluación diaria es idempotente: una alerta por patrón/factura y mes.
create unique index expense_alerts_unique_idx on erp.expense_alerts
  (kind, period, coalesce(pattern_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(invoice_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Traza de cada llamada a la API de Anthropic (coste, reproducibilidad).
create table erp.ai_runs (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('clasificacion', 'recurrencia', 'anomalias', 'conciliacion')),
  model text not null,
  input_hash text not null,
  input_tokens integer,
  output_tokens integer,
  output jsonb,
  error text,
  created_at timestamptz not null default now()
);

-- ── Nóminas (resumen mensual que aporta el gestor) ─────────────────────────
-- No vienen de Optimydent. Hacen falta para el P&L y para el Mod. 111
-- (retenciones de trabajadores), hoy la celda amarilla del Excel.
create table erp.payroll_months (
  period text primary key check (period ~ '^\d{4}-\d{2}$'),
  gross_salaries numeric(14, 2) not null default 0,
  worker_withholding numeric(14, 2) not null default 0,
  company_social_security numeric(14, 2) not null default 0,
  worker_social_security numeric(14, 2) not null default 0,
  partner_remuneration numeric(14, 2) not null default 0,    -- socia profesional de la SLP
  journal_entry_id uuid references erp.journal_entries (id),
  updated_at timestamptz not null default now()
);

create trigger payroll_months_set_updated_at
  before update on erp.payroll_months
  for each row execute function erp.set_updated_at();

-- Editable mientras el trimestre esté abierto (si ya estaba contabilizada, la
-- app anula el asiento con una rectificación y contabiliza el nuevo).
create or replace function erp.payroll_months_guard()
returns trigger
language plpgsql
as $$
begin
  perform erp.assert_period_open((coalesce(new.period, old.period) || '-01')::date);
  return coalesce(new, old);
end;
$$;

create trigger payroll_months_period_guard
  before insert or update or delete on erp.payroll_months
  for each row execute function erp.payroll_months_guard();

-- ── Exportaciones al gestor ────────────────────────────────────────────────
-- Cada generación es una versión nueva (v1, v2…): nunca se pisa un fichero
-- ya entregado. La vigente es la última de su periodo.
create table erp.gestor_exports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('trimestral', 'anual')),
  year smallint not null,
  quarter smallint check (quarter between 1 and 4),
  version smallint not null,
  file_name text not null,
  storage_path text not null,
  sha256 text not null,
  -- Relectura del .xlsx generado: nº de filas y sumas contra la BBDD.
  verification jsonb not null,
  generated_at timestamptz not null default now(),
  generated_by text not null,
  check ((kind = 'trimestral') = (quarter is not null)),
  unique (kind, year, quarter, version)
);

create trigger gestor_exports_immutable
  before update or delete on erp.gestor_exports
  for each row execute function erp.forbid_mutation();

-- ── Auditoría: toda edición manual deja antes/después y motivo ─────────────
create table erp.audit_log (
  id bigint generated always as identity primary key,
  actor text not null,
  action text not null,                             -- 'editar_campo', 'anular_factura', 'reabrir_trimestre'…
  entity text,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on erp.audit_log (entity, entity_id);

create trigger audit_log_immutable
  before update or delete on erp.audit_log
  for each row execute function erp.forbid_mutation();

-- ═══════════════════════════════════════════════════════════════════════════
-- Vistas de lectura (todo se calcula del Diario/facturas: sin saldos guardados)
-- ═══════════════════════════════════════════════════════════════════════════

-- Estado efectivo para los badges: 'atrasada' no se guarda, se deriva.
create view erp.v_invoices as
select i.*,
  case
    when i.status in ('pendiente', 'parcial') and i.due_date < (now() at time zone 'Europe/Madrid')::date
      then 'atrasada'
    else i.status
  end as effective_status,
  i.total - i.paid_amount as outstanding
from erp.invoices i;

-- Libro Mayor con saldo acumulado por cuenta.
create view erp.v_ledger as
select l.account_code, a.name as account_name, e.entry_date, e.fiscal_year, e.entry_number,
  e.description as entry_description, l.description, l.party_id, l.debit, l.credit,
  sum(l.debit - l.credit) over (partition by l.account_code order by e.entry_date, e.seq, l.line_no) as running_balance
from erp.journal_lines l
join erp.journal_entries e on e.id = l.entry_id
join erp.accounts a on a.code = l.account_code;

-- Balance de sumas y saldos (base de Balance vivo y P&L).
create view erp.v_trial_balance as
select a.code, a.name, a.kind, a.nature, e.fiscal_year,
  sum(l.debit) as total_debit, sum(l.credit) as total_credit,
  sum(l.debit - l.credit) as balance
from erp.journal_lines l
join erp.journal_entries e on e.id = l.entry_id
join erp.accounts a on a.code = l.account_code
group by a.code, a.name, a.kind, a.nature, e.fiscal_year;

-- IVA por trimestre y tipo (Modelo 303).
create view erp.v_vat_by_quarter as
select i.fiscal_year as year, extract(quarter from i.issue_date)::smallint as quarter,
  i.direction, l.vat_rate, (l.vat_exempt_reason is not null) as exempt,
  sum(l.base) as base, sum(l.vat_amount) as vat, count(distinct i.id) as invoices
from erp.invoices i
join erp.invoice_lines l on l.invoice_id = i.id
where i.status <> 'anulada'
group by 1, 2, 3, 4, 5;

-- Retenciones practicadas por trimestre (111 profesionales / 115 alquileres).
create view erp.v_withholding_by_quarter as
select i.fiscal_year as year, extract(quarter from i.issue_date)::smallint as quarter,
  coalesce(t.withholding_model, '111') as model, i.counterparty_id,
  count(distinct i.id) as invoices, sum(l.base) as base, sum(l.withholding_amount) as withholding
from erp.invoices i
join erp.invoice_lines l on l.invoice_id = i.id
left join erp.expense_types t on t.id = i.expense_type_id
where i.direction = 'recibida' and l.withholding_amount > 0 and i.status <> 'anulada'
group by 1, 2, 3, 4;

-- Cashflow proyectado: lo pendiente por fecha de vencimiento.
create view erp.v_cashflow_projection as
select coalesce(due_date, issue_date) as expected_date, direction,
  sum(case when direction = 'emitida' then total - paid_amount else -(total - paid_amount) end) as amount
from erp.invoices
where status in ('pendiente', 'parcial')
group by 1, 2;

-- Frescura de los datos: hasta qué fecha está cargada cada fuente. Los KPIs
-- muestran "datos hasta…" y el motor de recurrencia no alerta de facturas
-- "faltantes" en meses que aún no se han cargado.
create view erp.v_data_freshness as
select kind, max(covers_to) as covered_until, max(created_at) as last_loaded_at, count(*) as files
from erp.source_documents
group by kind;

-- Último listado de saldos por lado (acreedores / deudores).
create view erp.v_latest_balance_snapshots as
select distinct on (side) *
from erp.balance_snapshots
order by side, as_of desc, created_at desc;

-- Borrador Modelo 347 (anual): terceros con operaciones > 3.005,06 €.
-- Excluye lo sujeto a retención (ya va en 190/180). Validar criterios con el gestor.
create view erp.v_model_347_draft as
select i.fiscal_year as year, i.direction, p.id as party_id, p.tax_id, p.name,
  sum(i.total + i.withholding_total) as annual_amount,
  sum(i.total + i.withholding_total) filter (where extract(quarter from i.issue_date) = 1) as q1,
  sum(i.total + i.withholding_total) filter (where extract(quarter from i.issue_date) = 2) as q2,
  sum(i.total + i.withholding_total) filter (where extract(quarter from i.issue_date) = 3) as q3,
  sum(i.total + i.withholding_total) filter (where extract(quarter from i.issue_date) = 4) as q4
from erp.invoices i
join erp.parties p on p.id = i.counterparty_id
where i.status <> 'anulada' and i.withholding_total = 0
group by 1, 2, 3, 4, 5
having sum(i.total + i.withholding_total) > 3005.06;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS: activado en todo y sin políticas → solo el servidor (clave secreta).
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
begin
  foreach t in array array[
    'company_settings', 'accounts', 'expense_categories', 'expense_types', 'parties', 'tax_periods',
    'tax_period_events', 'sync_runs', 'source_documents', 'document_extractions', 'invoice_documents',
    'invoices', 'invoice_lines', 'invoice_status_history',
    'ingest_conflicts', 'balance_snapshots', 'balance_snapshot_lines', 'journal_entries',
    'journal_lines', 'bank_accounts', 'bank_transactions', 'reconciliations', 'recurring_patterns',
    'expense_alerts', 'ai_runs', 'payroll_months', 'gestor_exports', 'audit_log'
  ] loop
    execute format('alter table erp.%I enable row level security', t);
    execute format('revoke all on erp.%I from anon, authenticated', t);
  end loop;
end;
$$;

revoke all on erp.v_invoices, erp.v_ledger, erp.v_trial_balance, erp.v_vat_by_quarter,
  erp.v_withholding_by_quarter, erp.v_cashflow_projection, erp.v_data_freshness,
  erp.v_latest_balance_snapshots, erp.v_model_347_draft from anon, authenticated;

-- ── Permisos: el esquema erp solo existe para el servidor del ERP ─────────
-- Comparte proyecto Supabase con el CRM: los usuarios del CRM (anon /
-- authenticated) no tienen ni USAGE sobre el esquema, así que no ven nada.
revoke all on schema erp from public, anon, authenticated;
grant usage on schema erp to service_role;
grant all on all tables in schema erp to service_role;
grant all on all sequences in schema erp to service_role;
revoke execute on all functions in schema erp from public, anon, authenticated;
grant execute on all functions in schema erp to service_role;
