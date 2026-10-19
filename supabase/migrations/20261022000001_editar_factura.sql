-- Corregir desde la app el dato que provoca cada aviso, y que una factura
-- anulada deje de bloquear a la buena.
--
--   · fn_edit_invoice: nº, fecha, NIF (del proveedor o del paciente), tipo de
--     gasto y quitar líneas (p. ej. la línea repetida de Optimydent, dejando
--     UNA). Lo fiscal (nº, fecha, NIF del emisor, importes) se corrige anulando
--     y creando la buena enlazada (fn_correct_invoice); el resto se edita en el
--     sitio. Los avisos resueltos se quitan.
--   · Ingesta: un conflicto resuelto «mantener la existente» ya no bloquea el
--     dato entrante si esa existente se ha anulado después.
--   · Líneas: la cuenta se puede cambiar mientras la factura no esté
--     contabilizada (al cambiar el tipo de gasto). Importes, siempre inmutables.
--
-- Se puede ejecutar más de una vez.

create or replace function erp.invoice_lines_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (old.description is not distinct from new.description
          or (old.description is null and new.description is not null))
     and (old.account_code is not distinct from new.account_code
          or old.account_code is null
          or not exists (select 1 from erp.invoices i where i.id = new.invoice_id and i.journal_entry_id is not null))
     and (new.id, new.invoice_id, new.line_no, new.base, new.vat_rate, new.vat_amount, new.vat_exempt_reason,
          new.withholding_rate, new.withholding_amount)
         is not distinct from
         (old.id, old.invoice_id, old.line_no, old.base, old.vat_rate, old.vat_amount, old.vat_exempt_reason,
          old.withholding_rate, old.withholding_amount) then
    return new;
  end if;
  raise exception '% es inmutable: corrige con un asiento/registro de rectificación', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- ── Ingesta: conflictos cuya factura existente se anuló ────────────────────
create or replace function erp.fn_ingest_invoice(p jsonb, p_run uuid, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_res jsonb;
  v_hash text;
  v_c erp.ingest_conflicts;
  v_existing_status text;
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
          select status into v_existing_status from erp.invoices where id = v_c.existing_invoice_id;
          if v_existing_status = 'anulada' then
            -- La factura con la que chocaba ya no existe: el dato entrante sigue
            -- su camino normal (alta, o conflicto con otra viva).
            update erp.ingest_conflicts
               set resolution = 'mantener_ambas', resolved_at = now(),
                   resolution_note = 'La factura existente se anuló: se procesa de nuevo el dato entrante'
             where id = v_c.id;
          else
            return jsonb_build_object(
              'result', case when v_c.resolution = 'pendiente' then 'conflicto_pendiente' else 'ignorada_resuelta' end,
              'invoice_id', v_c.existing_invoice_id, 'conflict_id', v_c.id);
          end if;
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

-- ── Corregir los datos de una factura ──────────────────────────────────────
-- p: { invoice_number?, issue_date?, issuer_tax_id? (recibidas),
--      counterparty_tax_id?, counterparty_name? (emitidas),
--      expense_type_id? (recibidas), remove_lines?: [line_no…] }
-- Devuelve la factura resultante (la misma o la corregida).
create or replace function erp.fn_edit_invoice(p_invoice uuid, p jsonb, p_reason text, p_actor text)
returns uuid
language plpgsql
as $$
declare
  v erp.invoices;
  v_type erp.expense_types;
  v_clinic text;
  v_number text;
  v_date date;
  v_tax text;
  v_remove integer[];
  v_lines jsonb;
  v_base numeric;
  v_vat numeric;
  v_wh numeric;
  v_type_id uuid;
  v_type_changed boolean;
  v_identity boolean;
  v_resolved text[] := '{}';
  v_reasons text[];
  v_new uuid;
begin
  select * into v from erp.invoices where id = p_invoice for update;
  if not found then
    raise exception 'Factura % no encontrada', p_invoice using errcode = 'P0006';
  end if;
  if v.status = 'anulada' then
    raise exception 'La factura % está anulada', v.invoice_number using errcode = 'P0001';
  end if;
  select tax_id into v_clinic from erp.company_settings;

  v_number := coalesce(nullif(trim(p->>'invoice_number'), ''), v.invoice_number);
  v_date := coalesce(nullif(p->>'issue_date', '')::date, v.issue_date);
  v_tax := case when v.direction = 'recibida' and p ? 'issuer_tax_id'
                then erp.norm_tax_id(p->>'issuer_tax_id') else v.issuer_tax_id end;
  v_remove := coalesce(array(select (jsonb_array_elements_text(coalesce(p->'remove_lines', '[]'::jsonb)))::integer), '{}');

  if exists (select 1 from unnest(v_remove) r
              where r not in (select line_no from erp.invoice_lines where invoice_id = v.id)) then
    raise exception 'Línea no válida' using errcode = 'P0006';
  end if;

  v_type_id := case when v.direction = 'recibida' and p ? 'expense_type_id'
                    then nullif(p->>'expense_type_id', '')::uuid else v.expense_type_id end;
  v_type_changed := v_type_id is distinct from v.expense_type_id;
  if v_type_id is not null then
    select * into v_type from erp.expense_types where id = v_type_id;
    if not found then
      raise exception 'Tipo de gasto no encontrado' using errcode = 'P0006';
    end if;
  end if;

  -- Líneas que se conservan (si cambia el tipo, su cuenta la pone el tipo nuevo).
  select jsonb_agg(jsonb_build_object(
           'description', l.description, 'base', l.base, 'vat_rate', l.vat_rate, 'vat_amount', l.vat_amount,
           'vat_exempt_reason', l.vat_exempt_reason, 'withholding_rate', l.withholding_rate,
           'withholding_amount', l.withholding_amount,
           'account_code', case when v_type_changed then null else l.account_code end) order by l.line_no),
         coalesce(sum(l.base), 0), coalesce(sum(l.vat_amount), 0), coalesce(sum(l.withholding_amount), 0)
    into v_lines, v_base, v_vat, v_wh
    from erp.invoice_lines l
   where l.invoice_id = v.id and not (l.line_no = any(v_remove));
  if v_lines is null then
    raise exception 'La factura tiene que conservar al menos una línea: para quitarla entera, anúlala'
      using errcode = 'P0006';
  end if;

  -- Emitidas: el NIF y el nombre del paciente están en su ficha (no son de la factura).
  if v.direction = 'emitida' and (p ? 'counterparty_tax_id' or p ? 'counterparty_name') then
    begin
      update erp.parties set
        tax_id = case when p ? 'counterparty_tax_id' then erp.norm_tax_id(p->>'counterparty_tax_id') else tax_id end,
        name = coalesce(nullif(regexp_replace(trim(coalesce(p->>'counterparty_name', '')), '\s+', ' ', 'g'), ''), name)
      where id = v.counterparty_id;
    exception when unique_violation then
      raise exception 'Ya hay otra ficha de paciente con el NIF %: corrígelo en Optimydent o revisa ese paciente',
        erp.norm_tax_id(p->>'counterparty_tax_id') using errcode = 'P0001';
    end;
    if (select tax_id from erp.parties where id = v.counterparty_id) is not null then
      v_resolved := v_resolved || array['sin_nif'];
    end if;
  end if;

  -- Avisos que quedan resueltos con estos cambios.
  if v.direction = 'recibida' and v_tax is not null then
    v_resolved := v_resolved || array['sin_nif'];
    if v_tax <> v_clinic then
      v_resolved := v_resolved || array['nif_emisor_es_la_clinica'];
    end if;
  end if;
  if cardinality(v_remove) > 0 then
    v_resolved := v_resolved || array['linea_repetida_en_origen'];
  end if;
  if v_number <> v.invoice_number then
    v_resolved := v_resolved || array['numero_factura_repetido'];
    if not erp.is_placeholder_invoice_number(v_number) then
      v_resolved := v_resolved || array['sin_numero'];
    end if;
  end if;
  if v_type_changed then
    v_resolved := v_resolved || array['tipos_distintos_en_factura'];
    if v_type.account_code is not null then
      v_resolved := v_resolved || array['tipo_gasto_nuevo', 'tipo_gasto_sin_cuenta'];
    end if;
  end if;
  v_reasons := array(select r from unnest(v.review_reasons) r where not (r = any(v_resolved)));

  v_identity := v_number is distinct from v.invoice_number
             or v_date is distinct from v.issue_date
             or v_tax is distinct from v.issuer_tax_id
             or cardinality(v_remove) > 0;

  if v_identity then
    if length(trim(coalesce(p_reason, ''))) < 10 then
      raise exception 'Indica el motivo de la corrección (mín. 10 caracteres)' using errcode = 'P0005';
    end if;
    begin
      v_new := erp.fn_correct_invoice(
        v.id,
        jsonb_build_object(
          'issuer_tax_id', v_tax,
          'issuer_name', v.issuer_name,
          'invoice_number', v_number,
          'issue_date', v_date,
          'base_total', v_base,
          'vat_total', v_vat,
          'withholding_total', v_wh,
          'total', v_base + v_vat - v_wh,
          'review_reasons', to_jsonb(v_reasons),
          'lines', v_lines)
        || case when v.direction = 'recibida'
                then jsonb_build_object('expense_type', v_type.name) else '{}'::jsonb end
        || case when v.direction = 'recibida' and v_tax is distinct from v.issuer_tax_id
                then jsonb_build_object('counterparty', jsonb_build_object(
                       'kind', (select kind from erp.parties where id = v.counterparty_id),
                       'tax_id', v_tax, 'name', v.issuer_name))
                else '{}'::jsonb end,
        p_reason, p_actor);
    exception when unique_violation then
      raise exception 'Ya hay otra factura de este emisor con el nº % en %: elige otro nº o anula una de las dos.',
        v_number, extract(year from v_date) using errcode = 'P0001';
    end;
    if v_type_changed then
      update erp.invoices
         set manual_fields = array(select distinct unnest(manual_fields || array['expense_type_id']))
       where id = v_new;
    end if;
  else
    if v_type_changed then
      update erp.invoices set
        expense_type_id = v_type_id,
        category_id = coalesce(v_type.category_id, category_id),
        category_source = case when v_type.category_id is not null then 'manual' else category_source end,
        manual_fields = array(select distinct unnest(manual_fields || array['expense_type_id']))
      where id = v.id;
      if v_type.account_code is not null then
        update erp.invoice_lines set account_code = v_type.account_code where invoice_id = v.id;
      end if;
    end if;
    update erp.invoices set review_reasons = v_reasons, needs_review = cardinality(v_reasons) > 0
     where id = v.id and review_reasons is distinct from v_reasons;
    v_new := v.id;
    insert into erp.audit_log (actor, action, entity, entity_id, before, after, reason)
    values (p_actor, 'editar_factura', 'invoices', v.id::text,
            jsonb_build_object('expense_type_id', v.expense_type_id, 'review_reasons', v.review_reasons),
            p, nullif(trim(p_reason), ''));
  end if;
  return v_new;
end;
$$;

revoke execute on all functions in schema erp from public, anon, authenticated;
grant execute on all functions in schema erp to service_role;
