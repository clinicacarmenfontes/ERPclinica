-- ═══════════════════════════════════════════════════════════════════════════
-- Paso 3 · Datos maestros + funciones de ingesta y de Diario
--
-- Toda escritura "con reglas" pasa por una función SQL atómica; la app solo
-- prepara el documento normalizado (src/lib/ingest) y llama por RPC:
--   fn_ingest_invoices        alta | merge de estado | conflicto | lápida
--   fn_correct_invoice        "Corregir factura" = anular + crear enlazada
--   fn_resolve_conflict       mantener la existente | sustituir por la entrante
--   fn_ingest_bank_transactions  movimientos (solapes sin duplicar)
--   fn_ingest_balance_snapshot   foto de saldos de pacientes
--   fn_post_journal_entry     única vía de escritura al Diario
--   fn_reverse_journal_entry  asiento de rectificación
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Plan de cuentas (PGC pymes, 8 dígitos como Optimydent) ─────────────────
-- Editable desde Configuración (nombre/activa). Los códigos de gasto salen de
-- Estructuras Base/DOC ERP/diccionario_tipos_gasto.csv; ingresos de
-- mapeo_general_ingresos.csv; tesorería de tesoreria.csv.
insert into public.accounts (code, name, kind, nature) values
  ('10000000', 'Capital social',                                   'patrimonio', 'acreedora'),
  ('11300000', 'Reservas voluntarias',                             'patrimonio', 'acreedora'),
  ('12000000', 'Remanente',                                        'patrimonio', 'acreedora'),
  ('12100000', 'Resultados negativos de ejercicios anteriores',    'patrimonio', 'deudora'),
  ('12900000', 'Resultado del ejercicio',                          'patrimonio', 'acreedora'),
  ('17000000', 'Deudas a largo plazo con entidades de crédito',    'pasivo',     'acreedora'),
  ('20600000', 'Aplicaciones informáticas',                        'activo',     'deudora'),
  ('21300000', 'Maquinaria y equipamiento clínico',                'activo',     'deudora'),
  ('21600000', 'Mobiliario',                                       'activo',     'deudora'),
  ('21700000', 'Equipos para procesos de información',             'activo',     'deudora'),
  ('28060000', 'Amort. acumulada aplicaciones informáticas',       'activo',     'acreedora'),
  ('28130000', 'Amort. acumulada maquinaria',                      'activo',     'acreedora'),
  ('28160000', 'Amort. acumulada mobiliario',                      'activo',     'acreedora'),
  ('28170000', 'Amort. acumulada equipos informáticos',            'activo',     'acreedora'),
  ('40000000', 'Proveedores',                                      'pasivo',     'acreedora'),
  ('41000000', 'Acreedores por prestaciones de servicios',         'pasivo',     'acreedora'),
  ('43000000', 'Clientes (pacientes)',                             'activo',     'deudora'),
  ('43800000', 'Anticipos de clientes (pacientes)',                'pasivo',     'acreedora'),
  ('46500000', 'Remuneraciones pendientes de pago',                'pasivo',     'acreedora'),
  ('47200000', 'H.P. IVA soportado',                               'activo',     'deudora'),
  ('47300000', 'H.P. retenciones y pagos a cuenta',                'activo',     'deudora'),
  ('47510000', 'H.P. acreedora por retenciones practicadas',       'pasivo',     'acreedora'),
  ('47520000', 'H.P. acreedora por Impuesto sobre Sociedades',     'pasivo',     'acreedora'),
  ('47600000', 'Organismos de la Seguridad Social, acreedores',    'pasivo',     'acreedora'),
  ('47700000', 'H.P. IVA repercutido',                             'pasivo',     'acreedora'),
  ('52000000', 'Deudas a corto plazo con entidades de crédito',    'pasivo',     'acreedora'),
  ('55100000', 'Cuenta corriente con socios',                      'pasivo',     'acreedora'),
  ('57000000', 'Caja (efectivo)',                                  'activo',     'deudora'),
  ('57200000', 'Bancos · Kutxabank',                               'activo',     'deudora'),
  ('57200001', 'Bancos · CaixaBank',                               'activo',     'deudora'),
  ('60200000', 'Compras de material clínico',                      'gasto',      'deudora'),
  ('60700000', 'Trabajos de laboratorio',                          'gasto',      'deudora'),
  ('62100000', 'Arrendamientos y cánones',                         'gasto',      'deudora'),
  ('62200000', 'Reparaciones y conservación',                      'gasto',      'deudora'),
  ('62300000', 'Servicios de profesionales independientes',        'gasto',      'deudora'),
  ('62300002', 'Agencia de marketing (fee)',                       'gasto',      'deudora'),
  ('62500000', 'Primas de seguros',                                'gasto',      'deudora'),
  ('62700000', 'Publicidad y relaciones públicas',                 'gasto',      'deudora'),
  ('62700001', 'Publicidad online (Google, Meta, web)',            'gasto',      'deudora'),
  ('62700002', 'Publicidad offline y eventos',                     'gasto',      'deudora'),
  ('62800000', 'Suministros (luz, agua)',                          'gasto',      'deudora'),
  ('62900000', 'Otros servicios',                                  'gasto',      'deudora'),
  ('62900001', 'Alarmas y seguridad',                              'gasto',      'deudora'),
  ('62900002', 'Software y licencias',                             'gasto',      'deudora'),
  ('62900003', 'Material de oficina',                              'gasto',      'deudora'),
  ('62900004', 'Viajes y dietas',                                  'gasto',      'deudora'),
  ('62900005', 'Telecomunicaciones y mensajería',                  'gasto',      'deudora'),
  ('63000000', 'Impuesto sobre beneficios',                        'gasto',      'deudora'),
  ('63100000', 'Otros tributos',                                   'gasto',      'deudora'),
  ('64000000', 'Sueldos y salarios',                               'gasto',      'deudora'),
  ('64200000', 'Seguridad Social a cargo de la empresa',           'gasto',      'deudora'),
  ('64900000', 'Otros gastos sociales',                            'gasto',      'deudora'),
  ('64900001', 'Formación del personal',                           'gasto',      'deudora'),
  ('66200000', 'Intereses de deudas',                              'gasto',      'deudora'),
  ('66900000', 'Comisiones y otros gastos financieros',            'gasto',      'deudora'),
  ('68000000', 'Amortización del inmovilizado intangible',         'gasto',      'deudora'),
  ('68100000', 'Amortización del inmovilizado material',           'gasto',      'deudora'),
  ('70500000', 'Prestaciones de servicios',                        'ingreso',    'acreedora'),
  ('70500001', 'Odontología conservadora / general',               'ingreso',    'acreedora'),
  ('70500002', 'Ortodoncia',                                       'ingreso',    'acreedora'),
  ('70500003', 'Implantología y cirugía',                          'ingreso',    'acreedora'),
  ('70500004', 'Prótesis',                                         'ingreso',    'acreedora'),
  ('70500005', 'Periodoncia',                                      'ingreso',    'acreedora'),
  ('70500006', 'Estética dental',                                  'ingreso',    'acreedora'),
  ('70500010', 'Medicina estética (sujeta a IVA)',                 'ingreso',    'acreedora'),
  ('70500020', 'Servicios profesionales a otras clínicas',         'ingreso',    'acreedora'),
  ('70500021', 'Repercusión de materiales a otras clínicas',       'ingreso',    'acreedora'),
  ('76900000', 'Otros ingresos financieros',                       'ingreso',    'acreedora');

-- ── Tipos de gasto de Optimydent → cuenta + partida ────────────────────────
-- needs_review = el mapeo del CSV original es dudoso y conviene validarlo con
-- el gestor (p. ej. "IRPF" apunta a una cuenta de pasivo, no de gasto).
with t (name, account_code, category, behavior, withholding_model, needs_review) as (values
  ('Agencia Marketing (Fee)',             '62300002', 'Marketing',              'fijo',     null,  false),
  ('Agua y Otros Sum.',                   '62800000', 'Suministros',            'fijo',     null,  false),
  ('Alarmas',                             '62900001', 'Alquiler y local',       'fijo',     null,  false),
  ('Alquiler Local',                      '62100000', 'Alquiler y local',       'fijo',     '115', false),
  ('Alquiler - Otros',                    '62100000', 'Alquiler y local',       'fijo',     null,  false),
  ('Ayuntamiento',                        '63100000', 'Financiero e impuestos', 'fijo',     null,  false),
  ('Campaña',                             '62700002', 'Marketing',              'fijo',     null,  false),
  ('Comisiones Bancarias',                '66900000', 'Financiero e impuestos', 'variable', null,  false),
  ('Compra Maquinaria',                   '21300000', 'Inversión',              'fijo',     null,  false),
  ('Compra Material Clínica',             '60200000', 'Clínico',                'variable', null,  false),
  ('Compra ordenadores',                  '21700000', 'Inversión',              'fijo',     null,  false),
  ('Compras',                             '60200000', 'Clínico',                'variable', null,  false),
  ('Comunidad',                           '62900000', 'Alquiler y local',       'fijo',     null,  false),
  ('Correos y Mensajería',                '62900005', 'Servicios externos',     'variable', null,  false),
  ('Cursos Formación',                    '64900001', 'Personal',               'fijo',     null,  false),
  ('Devoluciones',                        '60200000', 'Clínico',                'variable', null,  true),
  ('Empresas de marketing',               '62300002', 'Marketing',              'fijo',     null,  false),
  ('Facebook',                            '62700001', 'Marketing',              'fijo',     null,  false),
  ('Factura de Luz',                      '62800000', 'Suministros',            'fijo',     null,  false),
  ('Facturas de Laboratorio',             '60700000', 'Clínico',                'variable', null,  false),
  ('Facturas doctores',                   '62300000', 'Personal',               'variable', '111', false),
  ('Formación personal',                  '64900001', 'Personal',               'fijo',     null,  false),
  ('Gastos bancarios',                    '66900000', 'Financiero e impuestos', 'variable', null,  false),
  ('Gastos financieros',                  '66900000', 'Financiero e impuestos', 'variable', null,  false),
  ('Gestoría y Abogados',                 '62300000', 'Servicios externos',     'fijo',     '111', false),
  ('Google',                              '62700001', 'Marketing',              'fijo',     null,  false),
  ('IBI',                                 '63100000', 'Financiero e impuestos', 'fijo',     null,  false),
  ('Impuestos - Otros',                   '63100000', 'Financiero e impuestos', 'fijo',     null,  false),
  ('Incentivos del personal',             '64000000', 'Personal',               'variable', null,  false),
  ('Inversiones',                         '21300000', 'Inversión',              'fijo',     null,  false),
  ('IRPF',                                '47510000', 'Financiero e impuestos', 'fijo',     null,  true),
  ('IRPF Personal',                       '47510000', 'Personal',               'fijo',     null,  true),
  ('Laboratorio',                         '60700000', 'Clínico',                'variable', null,  false),
  ('Leasing',                             '62100000', 'Alquiler y local',       'fijo',     null,  false),
  ('Limpieza / Mensajería',               '62900000', 'Alquiler y local',       'fijo',     null,  false),
  ('Local',                               '62100000', 'Alquiler y local',       'fijo',     '115', false),
  ('Luz',                                 '62800000', 'Suministros',            'fijo',     null,  false),
  ('Mantenimiento Equipos',               '62200000', 'Alquiler y local',       'fijo',     null,  false),
  ('Mantenimientos',                      '62200000', 'Alquiler y local',       'fijo',     null,  false),
  ('Marketing - Otros',                   '62700000', 'Marketing',              'fijo',     null,  false),
  ('Material de Oficina',                 '62900003', 'Servicios externos',     'variable', null,  false),
  ('Nóminas',                             '64000000', 'Personal',               'fijo',     null,  false),
  ('Nóminas (Salarios)',                  '64000000', 'Personal',               'fijo',     null,  false),
  ('Notaría/Abogados',                    '62300000', 'Servicios externos',     'fijo',     '111', false),
  ('Personal - Otros',                    '64900000', 'Personal',               'fijo',     null,  false),
  ('Préstamos - Otros',                   '66200000', 'Financiero e impuestos', 'fijo',     null,  true),
  ('Prevención riesgos',                  '62900000', 'Servicios externos',     'fijo',     null,  false),
  ('Prestación servicios profesionales',  '62300000', 'Personal',               'variable', '111', false),
  ('Publicidad Física/Eventos',           '62700002', 'Marketing',              'fijo',     null,  false),
  ('Publicidad Google/Web',               '62700001', 'Marketing',              'fijo',     null,  false),
  ('Publicidad Meta/FB',                  '62700001', 'Marketing',              'fijo',     null,  false),
  ('Reformas',                            '62200000', 'Alquiler y local',       'fijo',     null,  false),
  ('Renting',                             '62100000', 'Alquiler y local',       'fijo',     null,  false),
  ('Renting Equipos',                     '62100000', 'Alquiler y local',       'fijo',     null,  false),
  ('RRSS',                                '62700001', 'Marketing',              'fijo',     null,  false),
  ('Seguridad Social (TCs)',              '64200000', 'Personal',               'fijo',     null,  false),
  ('Seguros',                             '62500000', 'Servicios externos',     'fijo',     null,  false),
  ('Seguros Clínica',                     '62500000', 'Servicios externos',     'fijo',     null,  false),
  ('Seguros sociales',                    '64200000', 'Personal',               'fijo',     null,  false),
  ('Servicios generales - Otros',         '62900000', 'Servicios externos',     'fijo',     null,  false),
  ('Sociedades',                          '63000000', 'Financiero e impuestos', 'fijo',     null,  false),
  ('Software y Licencias',                '62900002', 'Software',               'fijo',     null,  false),
  ('Telecomunicaciones',                  '62900005', 'Suministros',            'variable', null,  false),
  ('Uniformes / Varios Staff',            '64900000', 'Personal',               'fijo',     null,  false),
  ('Viajes y Dietas',                     '62900004', 'Servicios externos',     'variable', null,  false)
)
insert into public.expense_types (name, account_code, category_id, behavior, withholding_model, needs_review)
select t.name, t.account_code, c.id, t.behavior, t.withholding_model, t.needs_review
from t join public.expense_categories c on c.name = t.category;

-- ── Cuentas de tesorería ────────────────────────────────────────────────────
-- Nº de cuenta (20 dígitos, CCC) para reconocer de qué cuenta es cada fichero.
-- Kutxabank lo trae en el PDF y se fija en la primera importación.
alter table public.bank_accounts add column account_number text unique
  check (account_number ~ '^\d{20}$');

insert into public.bank_accounts (name, bank, account_code) values
  ('Kutxabank', 'kutxabank', '57200000'),
  ('CaixaBank', 'caixabank', '57200001'),
  ('Caja (efectivo)', 'caja', '57000000');

-- ── Utilidades de ingesta ───────────────────────────────────────────────────
create or replace function public.issuer_key_of(p_tax_id text, p_name text)
returns text
language sql
immutable
as $$
  select coalesce(public.norm_tax_id(p_tax_id), 'N:' || public.norm_name(p_name));
$$;

-- Etiqueta comparable: 'Marketing -Otros' = 'Marketing - Otros' = 'marketing-otros'.
create or replace function public.norm_label(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(coalesce(p, '')), '[\s\-_./()]+', '', 'g');
$$;

create unique index expense_types_norm_label_idx on public.expense_types (public.norm_label(name));

-- Alta o localización de un tercero. Completa datos vacíos pero nunca pisa
-- lo que ya tiene (pueden ser ediciones manuales).
create or replace function public.fn_upsert_party(
  p_kind text, p_tax_id text, p_name text,
  p_clinical_record text default null, p_postal_code text default null, p_phone text default null
) returns uuid
language plpgsql
as $$
declare
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_key text;
  v_id uuid;
begin
  if v_name is null and public.norm_tax_id(p_tax_id) is null then
    raise exception 'Tercero sin NIF ni nombre' using errcode = 'P0006';
  end if;
  v_name := coalesce(v_name, public.norm_tax_id(p_tax_id));
  v_key := public.issuer_key_of(p_tax_id, v_name);

  select id into v_id from public.parties where kind = p_kind and party_key = v_key;
  if v_id is null then
    insert into public.parties (kind, tax_id, name, clinical_record, postal_code, phone)
    values (p_kind, public.norm_tax_id(p_tax_id), v_name,
            nullif(trim(p_clinical_record), ''), nullif(trim(p_postal_code), ''), nullif(trim(p_phone), ''))
    on conflict (kind, party_key) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.parties where kind = p_kind and party_key = v_key;
    end if;
  else
    update public.parties set
      clinical_record = coalesce(clinical_record, nullif(trim(p_clinical_record), '')),
      postal_code = coalesce(postal_code, nullif(trim(p_postal_code), '')),
      phone = coalesce(phone, nullif(trim(p_phone), ''))
    where id = v_id
      and ((clinical_record is null and nullif(trim(p_clinical_record), '') is not null)
        or (postal_code is null and nullif(trim(p_postal_code), '') is not null)
        or (phone is null and nullif(trim(p_phone), '') is not null));
  end if;
  return v_id;
end;
$$;

-- ── Ingesta de facturas ─────────────────────────────────────────────────────
-- Documento normalizado (lo construye src/lib/ingest):
-- { direction, issuer_tax_id, issuer_name, invoice_number, issue_date,
--   counterparty: {kind, tax_id, name, clinical_record, postal_code},
--   base_total, vat_total, withholding_total, total,
--   status, paid_amount, paid_at, due_date, payment_method,
--   expense_type, source, notes, review_reasons[],
--   lines: [{description, base, vat_rate, vat_amount, vat_exempt_reason,
--            withholding_rate, withholding_amount, account_code}],
--   corrects_invoice_id, force_insert }
--
-- Resultado: {result, invoice_id?, conflict_id?, message?}
--   insertada | actualizada | sin_cambios | ignorada_anulada (lápida)
--   conflicto (nuevo) | conflicto_pendiente | ignorada_resuelta | periodo_cerrado
create or replace function public.fn_ingest_invoice(p jsonb, p_run uuid, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_dir text := p->>'direction';
  v_issuer_tax text := public.norm_tax_id(p->>'issuer_tax_id');
  v_issuer_name text := regexp_replace(trim(coalesce(p->>'issuer_name', '')), '\s+', ' ', 'g');
  v_key text;
  v_number text := trim(coalesce(p->>'invoice_number', ''));
  v_number_norm text;
  v_date date := (p->>'issue_date')::date;
  v_base numeric := round((p->>'base_total')::numeric, 2);
  v_vat numeric := round(coalesce((p->>'vat_total')::numeric, 0), 2);
  v_wh numeric := round(coalesce((p->>'withholding_total')::numeric, 0), 2);
  v_total numeric := round((p->>'total')::numeric, 2);
  v_hash text;
  v_status text := coalesce(p->>'status', 'pendiente');
  v_paid numeric := round(coalesce((p->>'paid_amount')::numeric, 0), 2);
  v_paid_at date := (p->>'paid_at')::date;
  v_due date := (p->>'due_date')::date;
  v_method text := nullif(trim(coalesce(p->>'payment_method', '')), '');
  v_force boolean := coalesce((p->>'force_insert')::boolean, false);
  v_reasons text[] := coalesce(array(select jsonb_array_elements_text(p->'review_reasons')), '{}');
  v_inv public.invoices;
  v_type public.expense_types;
  v_type_id uuid;
  v_cat_id uuid;
  v_account text;
  v_cp uuid;
  v_cp_kind text;
  v_id uuid;
  v_conflict uuid;
  v_diff jsonb;
  v_sb numeric;
  v_sv numeric;
  v_sw numeric;
  v_closed boolean;
begin
  if v_dir not in ('emitida', 'recibida') then
    raise exception 'direction no válida: %', v_dir using errcode = 'P0006';
  end if;
  if v_number = '' or v_issuer_name = '' or v_date is null or v_total is null or v_base is null then
    raise exception 'Faltan datos obligatorios de la factura' using errcode = 'P0006';
  end if;
  if v_status not in ('pendiente', 'parcial', 'pagada') then
    raise exception 'Estado entrante no válido: %', v_status using errcode = 'P0006';
  end if;
  if v_status = 'pagada' then
    v_paid_at := coalesce(v_paid_at, v_date);
    v_paid := case when v_paid = 0 then v_total else v_paid end;
  end if;

  v_key := public.issuer_key_of(v_issuer_tax, v_issuer_name);
  v_number_norm := upper(regexp_replace(v_number, '\s', '', 'g'));
  v_hash := public.invoice_dedup_hash(v_key, v_number, v_date, v_total);

  -- Tipo de gasto (solo recibidas): conocido → cuenta y partida; nuevo → se da
  -- de alta sin cuenta y queda para revisión.
  if v_dir = 'recibida' and nullif(trim(coalesce(p->>'expense_type', '')), '') is not null then
    select * into v_type from public.expense_types
     where public.norm_label(name) = public.norm_label(p->>'expense_type');
    if not found then
      insert into public.expense_types (name, needs_review) values (trim(p->>'expense_type'), true)
      on conflict do nothing;
      select * into v_type from public.expense_types
       where public.norm_label(name) = public.norm_label(p->>'expense_type');
      v_reasons := array_append(v_reasons, 'tipo_gasto_nuevo');
    elsif v_type.account_code is null then
      v_reasons := array_append(v_reasons, 'tipo_gasto_sin_cuenta');
    end if;
    v_type_id := v_type.id;
    v_cat_id := v_type.category_id;
    v_account := v_type.account_code;
  end if;

  if not v_force then
    -- 1) La misma factura ya existe → merge de estado (Pendiente → Pagada…).
    select * into v_inv from public.invoices where dedup_hash = v_hash and status <> 'anulada' for update;
    if found then
      declare
        n_status text := case when 'status' = any(v_inv.manual_fields) then v_inv.status else v_status end;
        n_paid numeric := case when 'status' = any(v_inv.manual_fields) then v_inv.paid_amount else v_paid end;
        n_paid_at date := case when 'status' = any(v_inv.manual_fields) then v_inv.paid_at else v_paid_at end;
        n_method text := case when 'payment_method' = any(v_inv.manual_fields) then v_inv.payment_method
                              else coalesce(v_method, v_inv.payment_method) end;
        n_due date := case when 'due_date' = any(v_inv.manual_fields) then v_inv.due_date
                           else coalesce(v_due, v_inv.due_date) end;
        n_type uuid := v_inv.expense_type_id;
        n_cat uuid := v_inv.category_id;
        n_src text := v_inv.category_source;
      begin
        -- Reclasificación automática solo si no la tocaste a mano y el trimestre sigue abierto.
        select exists (select 1 from public.tax_periods
                        where year = extract(year from v_inv.issue_date)
                          and quarter = extract(quarter from v_inv.issue_date) and status = 'cerrado')
          into v_closed;
        if v_type_id is not null and not v_closed
           and coalesce(v_inv.category_source, 'regla') <> 'manual'
           and not ('expense_type_id' = any(v_inv.manual_fields)) then
          n_type := v_type_id;
          n_cat := coalesce(v_cat_id, v_inv.category_id);
          n_src := case when v_cat_id is not null then 'regla' else v_inv.category_source end;
        end if;

        if p_doc is not null then
          insert into public.invoice_documents (invoice_id, source_document_id, role)
          values (v_inv.id, p_doc, 'listado_origen') on conflict do nothing;
        end if;

        if (n_status, n_paid, n_paid_at, n_method, n_due, n_type, n_cat, n_src)
           is distinct from
           (v_inv.status, v_inv.paid_amount, v_inv.paid_at, v_inv.payment_method, v_inv.due_date,
            v_inv.expense_type_id, v_inv.category_id, v_inv.category_source) then
          update public.invoices set
            status = n_status, paid_amount = n_paid, paid_at = n_paid_at, payment_method = n_method,
            due_date = n_due, expense_type_id = n_type, category_id = n_cat, category_source = n_src,
            last_sync_run_id = coalesce(p_run, last_sync_run_id)
          where id = v_inv.id;
          return jsonb_build_object('result', 'actualizada', 'invoice_id', v_inv.id,
                                    'from_status', v_inv.status, 'to_status', n_status);
        end if;
        return jsonb_build_object('result', 'sin_cambios', 'invoice_id', v_inv.id);
      end;
    end if;

    -- 2) Lápida: ese dato exacto se anuló a propósito → se ignora.
    select id into v_id from public.invoices where dedup_hash = v_hash and status = 'anulada' limit 1;
    if found then
      return jsonb_build_object('result', 'ignorada_anulada', 'invoice_id', v_id);
    end if;

    -- 3) Mismo emisor + nº + ejercicio con otros datos → conflicto para decidir.
    select * into v_inv from public.invoices
     where direction = v_dir and issuer_key = v_key and invoice_number_norm = v_number_norm
       and fiscal_year = extract(year from v_date) and status <> 'anulada';
    if found then
      select id into v_conflict from public.ingest_conflicts
       where existing_invoice_id = v_inv.id and incoming->>'dedup_hash' = v_hash
         and resolution in ('pendiente', 'mantener_existente')
       order by created_at desc limit 1;
      if v_conflict is not null then
        return jsonb_build_object('result',
          case when (select resolution from public.ingest_conflicts where id = v_conflict) = 'pendiente'
               then 'conflicto_pendiente' else 'ignorada_resuelta' end,
          'invoice_id', v_inv.id, 'conflict_id', v_conflict);
      end if;
      v_diff := jsonb_strip_nulls(jsonb_build_object(
        'issue_date',        case when v_inv.issue_date <> v_date then jsonb_build_array(v_inv.issue_date, v_date) end,
        'issuer_name',       case when v_inv.issuer_name <> v_issuer_name then jsonb_build_array(v_inv.issuer_name, v_issuer_name) end,
        'base_total',        case when v_inv.base_total <> v_base then jsonb_build_array(v_inv.base_total, v_base) end,
        'vat_total',         case when v_inv.vat_total <> v_vat then jsonb_build_array(v_inv.vat_total, v_vat) end,
        'withholding_total', case when v_inv.withholding_total <> v_wh then jsonb_build_array(v_inv.withholding_total, v_wh) end,
        'total',             case when v_inv.total <> v_total then jsonb_build_array(v_inv.total, v_total) end));
      insert into public.ingest_conflicts (sync_run_id, existing_invoice_id, incoming, differences)
      values (p_run, v_inv.id, p || jsonb_build_object('dedup_hash', v_hash, 'source_document_id', p_doc), v_diff)
      returning id into v_conflict;
      return jsonb_build_object('result', 'conflicto', 'invoice_id', v_inv.id, 'conflict_id', v_conflict);
    end if;
  end if;

  -- 4) Alta. Un trimestre cerrado no admite facturas nuevas: se informa, no se rompe el lote.
  select exists (select 1 from public.tax_periods
                  where year = extract(year from v_date) and quarter = extract(quarter from v_date)
                    and status = 'cerrado')
    into v_closed;
  if v_closed then
    return jsonb_build_object('result', 'periodo_cerrado',
      'message', format('El trimestre %sT %s está cerrado', extract(quarter from v_date), extract(year from v_date)));
  end if;

  -- Las líneas deben sumar la cabecera (se comprueba aquí para devolver un
  -- error por factura en vez de abortar todo el lote al COMMIT).
  select coalesce(sum(round((l->>'base')::numeric, 2)), 0),
         coalesce(sum(round(coalesce((l->>'vat_amount')::numeric, 0), 2)), 0),
         coalesce(sum(round(coalesce((l->>'withholding_amount')::numeric, 0), 2)), 0)
    into v_sb, v_sv, v_sw
    from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) l;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0
     or v_sb <> v_base or v_sv <> v_vat or v_sw <> v_wh then
    raise exception 'Las líneas de la factura % no cuadran con la cabecera', v_number using errcode = 'P0003';
  end if;

  v_cp_kind := coalesce(p->'counterparty'->>'kind', case when v_dir = 'emitida' then 'paciente' else 'proveedor' end);
  v_cp := public.fn_upsert_party(
    v_cp_kind,
    coalesce(p->'counterparty'->>'tax_id', case when v_dir = 'recibida' then v_issuer_tax end),
    coalesce(p->'counterparty'->>'name', case when v_dir = 'recibida' then v_issuer_name end),
    p->'counterparty'->>'clinical_record', p->'counterparty'->>'postal_code', null);

  -- Sin tipo en el documento → el tipo por defecto del tercero (si lo tiene).
  if v_dir = 'recibida' and v_type_id is null then
    select t.* into v_type from public.parties pa join public.expense_types t on t.id = pa.default_expense_type_id
     where pa.id = v_cp;
    if found then
      v_type_id := v_type.id; v_cat_id := v_type.category_id; v_account := v_type.account_code;
    end if;
  end if;

  insert into public.invoices (
    direction, issuer_tax_id, issuer_name, invoice_number, issue_date, counterparty_id,
    base_total, vat_total, withholding_total, total, dedup_hash,
    status, due_date, paid_amount, paid_at, payment_method,
    expense_type_id, category_id, category_source,
    source, source_document_id, first_sync_run_id, last_sync_run_id, notes,
    needs_review, review_reasons, corrects_invoice_id
  ) values (
    v_dir, v_issuer_tax, v_issuer_name, v_number, v_date, v_cp,
    v_base, v_vat, v_wh, v_total, v_hash,
    v_status, v_due, v_paid, v_paid_at, v_method,
    v_type_id, v_cat_id, case when v_cat_id is not null then 'regla' end,
    coalesce(p->>'source', 'manual'), p_doc, p_run, p_run, nullif(p->>'notes', ''),
    cardinality(v_reasons) > 0, v_reasons, (p->>'corrects_invoice_id')::uuid
  ) returning id into v_id;

  insert into public.invoice_lines (invoice_id, line_no, description, base, vat_rate, vat_amount,
                                    vat_exempt_reason, withholding_rate, withholding_amount, account_code)
  select v_id, ord, nullif(l->>'description', ''),
         round((l->>'base')::numeric, 2),
         coalesce((l->>'vat_rate')::numeric, 0),
         round(coalesce((l->>'vat_amount')::numeric, 0), 2),
         nullif(l->>'vat_exempt_reason', ''),
         coalesce((l->>'withholding_rate')::numeric, 0),
         round(coalesce((l->>'withholding_amount')::numeric, 0), 2),
         coalesce(nullif(l->>'account_code', ''), v_account, case when v_dir = 'emitida' then '70500000' end)
    from jsonb_array_elements(p->'lines') with ordinality as t(l, ord);

  if p_doc is not null then
    insert into public.invoice_documents (invoice_id, source_document_id, role)
    values (v_id, p_doc, 'listado_origen') on conflict do nothing;
  end if;

  return jsonb_build_object('result', 'insertada', 'invoice_id', v_id);
end;
$$;

-- Lote: cada factura en su propia subtransacción. Un error en una no tumba
-- las demás; vuelve como {result: 'error', message} con su índice.
create or replace function public.fn_ingest_invoices(p_items jsonb, p_run uuid, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_res jsonb;
  v_i integer := 0;
begin
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_res := public.fn_ingest_invoice(v_item, p_run, p_doc);
    exception when others then
      v_res := jsonb_build_object('result', 'error', 'message', sqlerrm, 'code', sqlstate);
    end;
    v_out := v_out || jsonb_build_array(v_res || jsonb_build_object('index', v_i));
    v_i := v_i + 1;
  end loop;
  return v_out;
end;
$$;

-- ── Diario: única vía de escritura ─────────────────────────────────────────
-- {entry_date, description, kind, source_invoice_id?, reverses_entry_id?,
--  posted_by, lines: [{account_code, debit, credit, party_id?, description?}]}
-- Numeración correlativa por ejercicio sin huecos (advisory lock) y cadena de
-- hashes calculada con la MISMA representación que journal_entry_canonical().
create or replace function public.fn_post_journal_entry(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_date date := (p->>'entry_date')::date;
  v_year smallint := extract(year from (p->>'entry_date')::date)::smallint;
  v_id uuid := gen_random_uuid();
  v_num integer;
  v_prev text;
  v_lines text;
  v_canon text;
begin
  if nullif(trim(coalesce(p->>'description', '')), '') is null then
    raise exception 'El asiento necesita descripción' using errcode = 'P0006';
  end if;
  perform public.assert_period_open(v_date);
  perform pg_advisory_xact_lock(hashtext('public.journal_entries'));

  select coalesce(max(entry_number), 0) + 1 into v_num from public.journal_entries where fiscal_year = v_year;
  select chain_hash into v_prev from public.journal_entries order by seq desc limit 1;

  select string_agg(concat_ws(':', ord, l->>'account_code',
                              to_char(round(coalesce((l->>'debit')::numeric, 0), 2), 'FM999999999990.00'),
                              to_char(round(coalesce((l->>'credit')::numeric, 0), 2), 'FM999999999990.00'),
                              coalesce((l->>'party_id')::uuid::text, '')), ';' order by ord)
    into v_lines
    from jsonb_array_elements(p->'lines') with ordinality as t(l, ord);

  v_canon := concat_ws('|', v_year, v_num, to_char(v_date, 'YYYY-MM-DD'), p->>'kind', p->>'description', v_lines);

  insert into public.journal_entries (id, fiscal_year, entry_number, entry_date, description, kind,
                                      source_invoice_id, reverses_entry_id, prev_hash, chain_hash, posted_by)
  values (v_id, v_year, v_num, v_date, p->>'description', p->>'kind',
          (p->>'source_invoice_id')::uuid, (p->>'reverses_entry_id')::uuid, v_prev,
          encode(sha256(convert_to(coalesce(v_prev, '') || '|' || v_canon, 'UTF8')), 'hex'),
          coalesce(p->>'posted_by', 'sistema'));

  insert into public.journal_lines (entry_id, line_no, account_code, debit, credit, party_id, description)
  select v_id, ord, l->>'account_code',
         round(coalesce((l->>'debit')::numeric, 0), 2), round(coalesce((l->>'credit')::numeric, 0), 2),
         (l->>'party_id')::uuid, nullif(l->>'description', '')
    from jsonb_array_elements(p->'lines') with ordinality as t(l, ord);

  return v_id;
end;
$$;

-- Asiento inverso enlazado (Debe ↔ Haber). Un asiento solo se rectifica una vez.
create or replace function public.fn_reverse_journal_entry(
  p_entry_id uuid, p_date date, p_reason text, p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_e public.journal_entries;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Rectificar un asiento exige un motivo (mín. 10 caracteres)' using errcode = 'P0005';
  end if;
  select * into v_e from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Asiento % no encontrado', p_entry_id using errcode = 'P0006';
  end if;
  return public.fn_post_journal_entry(jsonb_build_object(
    'entry_date', coalesce(p_date, (now() at time zone 'Europe/Madrid')::date),
    'description', format('Rectificación del asiento %s/%s: %s', v_e.entry_number, v_e.fiscal_year, trim(p_reason)),
    'kind', 'rectificacion',
    'source_invoice_id', v_e.source_invoice_id,
    'reverses_entry_id', v_e.id,
    'posted_by', p_actor,
    'lines', (select jsonb_agg(jsonb_build_object(
                'account_code', l.account_code, 'debit', l.credit, 'credit', l.debit,
                'party_id', l.party_id, 'description', l.description) order by l.line_no)
                from public.journal_lines l where l.entry_id = v_e.id)));
end;
$$;

-- ── Corregir factura = anular + crear la buena enlazada ─────────────────────
-- p_incoming: documento normalizado con los datos correctos. Si la original
-- ya estaba contabilizada, se rectifica su asiento. Devuelve la nueva factura.
create or replace function public.fn_correct_invoice(
  p_invoice_id uuid, p_incoming jsonb, p_reason text, p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_old public.invoices;
  v_new_hash text;
  v_res jsonb;
  v_new_id uuid;
begin
  select * into v_old from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Factura % no encontrada', p_invoice_id using errcode = 'P0006';
  end if;
  if v_old.status = 'anulada' then
    raise exception 'La factura % ya está anulada', v_old.invoice_number using errcode = 'P0001';
  end if;

  v_new_hash := public.invoice_dedup_hash(
    public.issuer_key_of(p_incoming->>'issuer_tax_id', p_incoming->>'issuer_name'),
    p_incoming->>'invoice_number', (p_incoming->>'issue_date')::date, (p_incoming->>'total')::numeric);
  if v_new_hash = v_old.dedup_hash then
    raise exception 'Los datos fiscales no cambian: para la categoría o las notas edita la factura directamente'
      using errcode = 'P0007';
  end if;

  -- Anular (el trigger exige motivo y trimestre abierto).
  update public.invoices set status = 'anulada', void_reason = trim(p_reason), voided_at = now()
   where id = v_old.id;

  if v_old.journal_entry_id is not null then
    perform public.fn_reverse_journal_entry(v_old.journal_entry_id, null, p_reason, p_actor);
  end if;

  -- La corregida hereda la analítica y el estado de cobro si no se indican.
  -- Pagada → pagada por su NUEVO total (el cobrado de la vieja ya no aplica).
  v_res := public.fn_ingest_invoice(
    jsonb_build_object(
      'direction', v_old.direction,
      'status', v_old.status,
      'paid_amount', case when v_old.status = 'parcial' then v_old.paid_amount else 0 end,
      'paid_at', v_old.paid_at,
      'payment_method', v_old.payment_method,
      'due_date', v_old.due_date,
      'source', 'manual',
      'notes', v_old.notes,
      'expense_type', (select name from public.expense_types where id = v_old.expense_type_id),
      'counterparty', (select jsonb_build_object('kind', kind, 'tax_id', tax_id, 'name', name)
                         from public.parties where id = v_old.counterparty_id)
    ) || p_incoming || jsonb_build_object('corrects_invoice_id', v_old.id, 'force_insert', true),
    v_old.last_sync_run_id, null);
  v_new_id := (v_res->>'invoice_id')::uuid;
  if v_res->>'result' <> 'insertada' then
    raise exception 'No se pudo crear la factura corregida: %', v_res using errcode = 'P0006';
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, before, after, reason)
  values (p_actor, 'corregir_factura', 'invoices', v_old.id::text,
          to_jsonb(v_old), jsonb_build_object('nueva_factura', v_new_id, 'datos', p_incoming), trim(p_reason));
  return v_new_id;
end;
$$;

create or replace function public.fn_resolve_conflict(
  p_conflict_id uuid, p_resolution text, p_note text, p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_c public.ingest_conflicts;
  v_new uuid;
begin
  select * into v_c from public.ingest_conflicts where id = p_conflict_id for update;
  if not found then
    raise exception 'Conflicto % no encontrado', p_conflict_id using errcode = 'P0006';
  end if;
  if v_c.resolution <> 'pendiente' then
    raise exception 'El conflicto ya está resuelto' using errcode = 'P0001';
  end if;
  if p_resolution = 'sustituir_por_entrante' then
    v_new := public.fn_correct_invoice(
      v_c.existing_invoice_id,
      v_c.incoming - 'dedup_hash' - 'source_document_id' - 'force_insert' - 'corrects_invoice_id',
      coalesce(nullif(trim(p_note), ''), 'Sustituida por el dato entrante de la sincronización'),
      p_actor);
  elsif p_resolution <> 'mantener_existente' then
    raise exception 'Resolución no válida: %', p_resolution using errcode = 'P0006';
  end if;
  update public.ingest_conflicts
     set resolution = p_resolution, resolution_note = nullif(trim(p_note), ''), resolved_at = now()
   where id = v_c.id;
  insert into public.audit_log (actor, action, entity, entity_id, after, reason)
  values (p_actor, 'resolver_conflicto', 'ingest_conflicts', v_c.id::text,
          jsonb_build_object('resolution', p_resolution, 'nueva_factura', v_new), nullif(trim(p_note), ''));
  return v_new;
end;
$$;

-- ── Movimientos bancarios ───────────────────────────────────────────────────
-- p_items: [{booking_date, value_date, amount, balance_after, description, ordinal}]
-- Huella = cuenta|fecha|importe|saldo. El saldo tras el movimiento distingue
-- cargos idénticos del mismo día (p. ej. tres recibos de 859,10 € de ORMCO).
-- Sin saldo, se usa concepto + nº de orden en el fichero.
create or replace function public.bank_tx_import_hash(
  p_account uuid, p_date date, p_amount numeric, p_balance numeric, p_description text, p_ordinal integer
) returns text
language sql
immutable
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_account::text, to_char(p_date, 'YYYY-MM-DD'),
    to_char(round(p_amount, 2), 'FM999999999990.00'),
    case when p_balance is not null then to_char(round(p_balance, 2), 'FM999999999990.00')
         else 'NB:' || public.norm_name(p_description) || ':' || coalesce(p_ordinal, 0) end
  ), 'UTF8')), 'hex');
$$;

create or replace function public.fn_ingest_bank_transactions(p_account uuid, p_items jsonb, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_inserted integer;
  v_total integer := jsonb_array_length(p_items);
begin
  with ins as (
    insert into public.bank_transactions (bank_account_id, booking_date, value_date, amount, balance_after,
                                          description, source, source_document_id, import_hash)
    select p_account, (x->>'booking_date')::date, (x->>'value_date')::date,
           round((x->>'amount')::numeric, 2), round((x->>'balance_after')::numeric, 2),
           regexp_replace(trim(x->>'description'), '\s+', ' ', 'g'), 'excel_banco', p_doc,
           public.bank_tx_import_hash(p_account, (x->>'booking_date')::date, (x->>'amount')::numeric,
                                      (x->>'balance_after')::numeric, x->>'description', (x->>'ordinal')::integer)
      from jsonb_array_elements(p_items) x
    on conflict (import_hash) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  return jsonb_build_object('insertados', v_inserted, 'duplicados', v_total - v_inserted);
end;
$$;

-- Saldo actual por cuenta: el movimiento cuyo saldo no es el "saldo anterior"
-- de ningún otro (el último de la cadena).
create view public.v_bank_latest_balance as
select distinct on (t.bank_account_id) t.bank_account_id, t.booking_date, t.balance_after
from public.bank_transactions t
where t.balance_after is not null
  and not exists (
    select 1 from public.bank_transactions s
     where s.bank_account_id = t.bank_account_id and s.id <> t.id
       and s.booking_date >= t.booking_date and s.balance_after - s.amount = t.balance_after)
order by t.bank_account_id, t.booking_date desc;

-- Huecos: movimientos cuyo saldo anterior no aparece en ningún movimiento
-- cargado (falta subir un tramo de extracto). El primero de cada cuenta no cuenta.
create view public.v_bank_chain_breaks as
select t.bank_account_id, t.booking_date, t.description, t.amount, t.balance_after,
       t.balance_after - t.amount as missing_previous_balance
from public.bank_transactions t
where t.balance_after is not null
  and t.booking_date > (select min(x.booking_date) from public.bank_transactions x
                         where x.bank_account_id = t.bank_account_id)
  and not exists (
    select 1 from public.bank_transactions p
     where p.bank_account_id = t.bank_account_id and p.id <> t.id
       and p.booking_date <= t.booking_date and p.balance_after = t.balance_after - t.amount);

-- Totales por mes y dirección (KPIs, gráficas). Las anuladas no cuentan.
create view public.v_invoice_monthly as
select direction, fiscal_year as year, extract(month from issue_date)::smallint as month,
  count(*)::int as invoices, sum(base_total) as base, sum(vat_total) as vat,
  sum(withholding_total) as withholding, sum(total) as total,
  coalesce(sum(total - paid_amount) filter (where status in ('pendiente', 'parcial')), 0) as outstanding,
  count(*) filter (where needs_review)::int as needs_review
from public.invoices
where status <> 'anulada'
group by 1, 2, 3;

revoke all on public.v_bank_latest_balance, public.v_bank_chain_breaks, public.v_invoice_monthly
  from anon, authenticated;

-- ── Saldos de pacientes ─────────────────────────────────────────────────────
-- {as_of, side, lines: [{tax_id, name, clinical_record, phone, postal_code, balance}]}
-- Misma foto (mismo día, lado y contenido) subida dos veces → sin cambios.
create or replace function public.fn_ingest_balance_snapshot(p jsonb, p_run uuid, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_side text := p->>'side';
  v_as_of date := (p->>'as_of')::date;
  v_hash text;
  v_id uuid;
  v_total numeric;
  v_n integer;
begin
  if v_side not in ('acreedores', 'deudores') then
    raise exception 'Lado de saldos no válido: %', v_side using errcode = 'P0006';
  end if;

  create temporary table _snap on commit drop as
  select public.fn_upsert_party('paciente', x->>'tax_id', x->>'name', x->>'clinical_record',
                                x->>'postal_code', x->>'phone') as party_id,
         round((x->>'balance')::numeric, 2) as balance
    from jsonb_array_elements(p->'lines') x
   where round((x->>'balance')::numeric, 2) <> 0;

  -- Un paciente con dos fichas (mismo NIF) suma sus saldos.
  create temporary table _snap_agg on commit drop as
  select party_id, sum(balance) as balance from _snap group by party_id having sum(balance) <> 0;

  if v_side = 'acreedores' and exists (select 1 from _snap_agg where balance < 0)
     or v_side = 'deudores' and exists (select 1 from _snap_agg where balance > 0) then
    raise exception 'El listado de % contiene saldos del signo contrario', v_side using errcode = 'P0006';
  end if;

  select encode(sha256(convert_to(coalesce(string_agg(party_id::text || ':' ||
                to_char(balance, 'FM999999999990.00'), ';' order by party_id), ''), 'UTF8')), 'hex'),
         coalesce(sum(balance), 0), count(*)
    into v_hash, v_total, v_n
    from _snap_agg;

  insert into public.balance_snapshots (as_of, side, sync_run_id, source_document_id, content_hash, total, patients)
  values (v_as_of, v_side, p_run, p_doc, v_hash, v_total, v_n)
  on conflict (as_of, side, content_hash) do nothing
  returning id into v_id;

  if v_id is null then
    drop table _snap; drop table _snap_agg;
    return jsonb_build_object('result', 'sin_cambios', 'total', v_total, 'patients', v_n);
  end if;

  insert into public.balance_snapshot_lines (snapshot_id, party_id, balance)
  select v_id, party_id, balance from _snap_agg;
  drop table _snap; drop table _snap_agg;
  return jsonb_build_object('result', 'insertada', 'snapshot_id', v_id, 'total', v_total, 'patients', v_n);
end;
$$;

-- ── Ejecuciones colgadas ────────────────────────────────────────────────────
-- Si una sincronización muere a medias (timeout de la función), queda
-- 'en_curso' y bloquearía las siguientes: se cierra sola a los 15 minutos.
create or replace function public.fn_start_sync_run(p_channel text, p_trigger text, p_actor text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  update public.sync_runs set status = 'fallido', finished_at = now(),
         error = 'Interrumpida: superó 15 minutos sin terminar'
   where status = 'en_curso' and started_at < now() - interval '15 minutes';
  insert into public.sync_runs (channel, trigger, triggered_by)
  values (p_channel, p_trigger, p_actor) returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ya hay una sincronización en curso; espera a que termine' using errcode = 'P0008';
end;
$$;

-- ── Bucket privado para los originales ─────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('documentos', 'documentos', false)
    on conflict (id) do nothing;
  end if;
end;
$$;

-- ── Permisos: las funciones solo para el servidor ──────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
