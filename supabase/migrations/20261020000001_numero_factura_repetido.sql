-- Facturas que comparten emisor + nº + año y son legítimamente distintas.
--
-- 1) Cargos SIN nº de factura (seguros, recibos…): Optimydent los exporta con
--    "-" en Factura. Cada cargo es un registro propio: la huella (emisor + nº
--    + fecha + total) ya distingue un mes de otro, así que nunca se mandan a
--    conflicto por el nº. Quedan marcados «sin_numero».
-- 2) Nº de factura REPETIDO con otra fecha / importe (un nº mal tecleado): el
--    conflicto admite una tercera salida, «mantener ambas». Las dos facturas
--    quedan vivas, marcadas para revisar («numero_factura_repetido») y con una
--    nota que apunta a la otra. Después se puede anular una, corregir su nº o
--    fecha (fn_correct_invoice_identity) o darlas por revisadas.
--
-- La segunda barrera (índice único emisor + nº + año) deja de aplicarse a los
-- números de relleno y a las facturas con shares_number. La primera barrera
-- (huella única entre las vivas) no cambia: un dato idéntico nunca se duplica.

-- ── Números de relleno ─────────────────────────────────────────────────────
-- "-", "--", "S/N", "sin número"… (sin letras ni cifras significativas).
create or replace function erp.is_placeholder_invoice_number(p text)
returns boolean
language sql
immutable
as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g') in ('', 'SN', 'SINNUMERO', 'SINNUM');
$$;

-- ── Nº compartido aceptado a sabiendas ─────────────────────────────────────
alter table erp.invoices add column shares_number boolean not null default false;
comment on column erp.invoices.shares_number is
  'Comparte emisor + nº + año con otra factura viva y se decidió mantener ambas (conflicto «mantener_ambas»).';

drop index erp.invoices_natural_key_live_idx;
create unique index invoices_natural_key_live_idx on erp.invoices
  (direction, issuer_key, invoice_number_norm, fiscal_year)
  where status <> 'anulada' and not shares_number and not erp.is_placeholder_invoice_number(invoice_number);

alter table erp.ingest_conflicts drop constraint ingest_conflicts_resolution_check;
alter table erp.ingest_conflicts add constraint ingest_conflicts_resolution_check
  check (resolution in (
    'pendiente',
    'mantener_existente',     -- el dato bueno es el que ya estaba (se ignora el entrante)
    'sustituir_por_entrante', -- se anula la existente y se crea la entrante enlazada (corrects_invoice_id)
    'mantener_ambas'          -- son dos facturas distintas: se registra también la entrante
  ));

-- ── Ingesta ────────────────────────────────────────────────────────────────
-- Antes de la ingesta normal (fn_ingest_invoice_base), y solo si el dato es
-- nuevo (su huella no existe, ni viva ni anulada):
--   · nº de relleno → alta directa, sin pasar por el conflicto de nº;
--   · ya hubo un conflicto con este mismo dato → se devuelve ese, aunque el
--     nº lo compartan varias facturas (evita conflictos repetidos).
-- Después, como antes, se completan los datos vacíos de la factura existente.
create or replace function erp.fn_ingest_invoice(p jsonb, p_run uuid, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_res jsonb;
  v_hash text;
  v_c erp.ingest_conflicts;
begin
  if not coalesce((p->>'force_insert')::boolean, false)
     and nullif(p->>'issue_date', '') is not null and nullif(p->>'total', '') is not null then
    v_hash := erp.invoice_dedup_hash(
      erp.issuer_key_of(p->>'issuer_tax_id', regexp_replace(trim(coalesce(p->>'issuer_name', '')), '\s+', ' ', 'g')),
      trim(coalesce(p->>'invoice_number', '')),
      (p->>'issue_date')::date,
      round((p->>'total')::numeric, 2));
    if not exists (select 1 from erp.invoices where dedup_hash = v_hash) then
      if erp.is_placeholder_invoice_number(p->>'invoice_number') then
        p := p || jsonb_build_object('force_insert', true);
        if not coalesce(p->'review_reasons', '[]'::jsonb) ? 'sin_numero' then
          p := jsonb_set(p, '{review_reasons}', coalesce(p->'review_reasons', '[]'::jsonb) || '["sin_numero"]'::jsonb);
        end if;
      else
        select * into v_c from erp.ingest_conflicts
         where incoming->>'dedup_hash' = v_hash and resolution in ('pendiente', 'mantener_existente')
         order by created_at desc limit 1;
        if found then
          return jsonb_build_object(
            'result', case when v_c.resolution = 'pendiente' then 'conflicto_pendiente' else 'ignorada_resuelta' end,
            'invoice_id', v_c.existing_invoice_id, 'conflict_id', v_c.id);
        end if;
      end if;
    end if;
  end if;

  v_res := erp.fn_ingest_invoice_base(p, p_run, p_doc);
  if v_res->>'result' in ('sin_cambios', 'actualizada')
     and erp.fn_fill_invoice_gaps((v_res->>'invoice_id')::uuid, p) > 0 then
    if v_res->>'result' = 'sin_cambios' then
      v_res := v_res || jsonb_build_object('result', 'completada');
    end if;
    if p_run is not null then
      update erp.invoices set last_sync_run_id = p_run where id = (v_res->>'invoice_id')::uuid;
    end if;
  end if;
  return v_res;
end;
$$;

-- ── Resolver conflictos: + «mantener ambas» ────────────────────────────────
create or replace function erp.fn_resolve_conflict(
  p_conflict_id uuid, p_resolution text, p_note text, p_actor text
) returns uuid
language plpgsql
as $$
declare
  v_c erp.ingest_conflicts;
  v_old erp.invoices;
  v_inc jsonb;
  v_res jsonb;
  v_new uuid;
  v_placeholder boolean;
  v_reason text;
begin
  select * into v_c from erp.ingest_conflicts where id = p_conflict_id for update;
  if not found then
    raise exception 'Conflicto % no encontrado', p_conflict_id using errcode = 'P0006';
  end if;
  if v_c.resolution <> 'pendiente' then
    raise exception 'El conflicto ya está resuelto' using errcode = 'P0001';
  end if;
  v_inc := v_c.incoming - 'dedup_hash' - 'source_document_id' - 'force_insert' - 'corrects_invoice_id';

  if p_resolution = 'sustituir_por_entrante' then
    v_new := erp.fn_correct_invoice(
      v_c.existing_invoice_id, v_inc,
      coalesce(nullif(trim(p_note), ''), 'Sustituida por el dato entrante de la sincronización'),
      p_actor);
  elsif p_resolution = 'mantener_ambas' then
    select * into v_old from erp.invoices where id = v_c.existing_invoice_id for update;
    v_placeholder := erp.is_placeholder_invoice_number(v_inc->>'invoice_number');
    v_reason := case when v_placeholder then 'sin_numero' else 'numero_factura_repetido' end;

    -- La existente: nº compartido + revisar + nota que apunta a la entrante.
    if not v_placeholder and v_old.status <> 'anulada' then
      update erp.invoices set
        shares_number = true,
        needs_review = true,
        review_reasons = case when v_reason = any(review_reasons) then review_reasons
                              else array_append(review_reasons, v_reason) end,
        notes = concat_ws(' ', nullif(notes, ''), format(
          'Nº de factura repetido: también existe otra del %s por %s €. Revisa el nº.',
          to_char((v_inc->>'issue_date')::date, 'DD/MM/YYYY'),
          replace(to_char(round((v_inc->>'total')::numeric, 2), 'FM999999990.00'), '.', ',')))
      where id = v_old.id;
    end if;

    -- La entrante: alta directa con la misma marca y nota.
    v_res := erp.fn_ingest_invoice(
      v_inc || jsonb_build_object(
        'force_insert', true,
        'review_reasons', coalesce(v_inc->'review_reasons', '[]'::jsonb) || to_jsonb(array[v_reason]),
        'notes', concat_ws(' ', nullif(v_inc->>'notes', ''), case when not v_placeholder then format(
          'Nº de factura repetido: también existe otra del %s por %s €. Revisa el nº.',
          to_char(v_old.issue_date, 'DD/MM/YYYY'),
          replace(to_char(v_old.total, 'FM999999990.00'), '.', ',')) end)),
      v_c.sync_run_id, nullif(v_c.incoming->>'source_document_id', '')::uuid);
    if v_res->>'result' <> 'insertada' then
      raise exception 'No se pudo registrar la factura entrante: %', coalesce(v_res->>'message', v_res->>'result')
        using errcode = 'P0006';
    end if;
    v_new := (v_res->>'invoice_id')::uuid;
    if not v_placeholder then
      update erp.invoices set shares_number = true where id = v_new;
    end if;
  elsif p_resolution <> 'mantener_existente' then
    raise exception 'Resolución no válida: %', p_resolution using errcode = 'P0006';
  end if;

  update erp.ingest_conflicts
     set resolution = p_resolution, resolution_note = nullif(trim(p_note), ''), resolved_at = now()
   where id = v_c.id;
  insert into erp.audit_log (actor, action, entity, entity_id, after, reason)
  values (p_actor, 'resolver_conflicto', 'ingest_conflicts', v_c.id::text,
          jsonb_build_object('resolution', p_resolution, 'nueva_factura', v_new), nullif(trim(p_note), ''));
  return v_new;
end;
$$;

-- ── Acciones sobre una factura ─────────────────────────────────────────────
-- Anular (queda como lápida: si Optimydent vuelve a mandar ese dato, se ignora).
create or replace function erp.fn_void_invoice(p_invoice uuid, p_reason text, p_actor text)
returns void
language plpgsql
as $$
declare
  v erp.invoices;
begin
  select * into v from erp.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Factura % no encontrada', p_invoice using errcode = 'P0006';
  end if;
  if v.status = 'anulada' then
    raise exception 'La factura % ya está anulada', v.invoice_number using errcode = 'P0001';
  end if;
  update erp.invoices set status = 'anulada', void_reason = trim(p_reason), voided_at = now() where id = v.id;
  if v.journal_entry_id is not null then
    perform erp.fn_reverse_journal_entry(v.journal_entry_id, null, p_reason, p_actor);
  end if;
  insert into erp.audit_log (actor, action, entity, entity_id, before, reason)
  values (p_actor, 'anular_factura', 'invoices', v.id::text, to_jsonb(v), trim(p_reason));
end;
$$;

-- Corregir nº y/o fecha: anula la factura y crea la buena enlazada con los
-- mismos importes, líneas, contrapartida y analítica (fn_correct_invoice).
create or replace function erp.fn_correct_invoice_identity(
  p_invoice uuid, p_number text, p_date date, p_reason text, p_actor text
) returns uuid
language plpgsql
as $$
declare
  v erp.invoices;
begin
  select * into v from erp.invoices where id = p_invoice;
  if not found then
    raise exception 'Factura % no encontrada', p_invoice using errcode = 'P0006';
  end if;
  if trim(coalesce(p_number, '')) = '' or p_date is null then
    raise exception 'Indica el nº y la fecha de la factura' using errcode = 'P0006';
  end if;
  return erp.fn_correct_invoice(
    p_invoice,
    jsonb_build_object(
      'issuer_tax_id', v.issuer_tax_id,
      'issuer_name', v.issuer_name,
      'invoice_number', trim(p_number),
      'issue_date', p_date,
      'base_total', v.base_total,
      'vat_total', v.vat_total,
      'withholding_total', v.withholding_total,
      'total', v.total,
      'review_reasons', '[]'::jsonb,
      'lines', (select jsonb_agg(jsonb_build_object(
                  'description', description, 'base', base, 'vat_rate', vat_rate, 'vat_amount', vat_amount,
                  'vat_exempt_reason', vat_exempt_reason, 'withholding_rate', withholding_rate,
                  'withholding_amount', withholding_amount, 'account_code', account_code) order by line_no)
                  from erp.invoice_lines where invoice_id = v.id)),
    p_reason, p_actor);
exception
  when unique_violation then
    raise exception 'Ya hay otra factura de este emisor con el nº % en %: elige otro nº o anula una de las dos.',
      trim(p_number), extract(year from p_date) using errcode = 'P0001';
end;
$$;

-- Dar por revisada (quita la marca; el nº compartido se mantiene).
create or replace function erp.fn_mark_invoice_reviewed(p_invoice uuid, p_note text, p_actor text)
returns void
language plpgsql
as $$
declare
  v erp.invoices;
begin
  select * into v from erp.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Factura % no encontrada', p_invoice using errcode = 'P0006';
  end if;
  if v.status = 'anulada' then
    raise exception 'La factura % está anulada', v.invoice_number using errcode = 'P0001';
  end if;
  update erp.invoices set needs_review = false, review_reasons = '{}' where id = v.id;
  insert into erp.audit_log (actor, action, entity, entity_id, before, reason)
  values (p_actor, 'revisar_factura', 'invoices', v.id::text,
          jsonb_build_object('review_reasons', v.review_reasons), nullif(trim(p_note), ''));
end;
$$;

-- ── Datos ya cargados ──────────────────────────────────────────────────────
-- Cargos con nº de relleno ya dados de alta: marcados «sin_numero».
update erp.invoices
   set needs_review = true, review_reasons = array_append(review_reasons, 'sin_numero')
 where status <> 'anulada'
   and erp.is_placeholder_invoice_number(invoice_number)
   and not ('sin_numero' = any(review_reasons));

-- Conflictos pendientes de cargos sin nº (los seguros): se registran todos.
-- Si alguno no puede (p. ej. trimestre cerrado), sigue pendiente.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select id from erp.ingest_conflicts
     where resolution = 'pendiente' and erp.is_placeholder_invoice_number(incoming->>'invoice_number')
     order by created_at
  loop
    begin
      perform erp.fn_resolve_conflict(v_id, 'mantener_ambas',
        'Cargo sin nº de factura (p. ej. seguro mensual): se registran todos', 'sistema');
    exception when others then
      raise notice 'Conflicto % sigue pendiente: %', v_id, sqlerrm;
    end;
  end loop;
end;
$$;

revoke execute on all functions in schema erp from public, anon, authenticated;
grant execute on all functions in schema erp to service_role;
