-- Listados de Optimydent con columnas secundarias ausentes (concepto, nº de
-- historia, código postal…): las columnas se eligen a mano al exportar y a
-- veces falta alguna. Si después se sube el listado con esas columnas, la
-- factura ya existe (misma huella) y solo se COMPLETAN los datos vacíos:
-- nunca se pisa un dato que ya tenga valor (puede ser una edición manual).
--
--   · invoice_lines.description  → la única columna de las líneas que se
--     puede rellenar, y solo de NULL a un valor. El resto sigue inmutable.
--   · parties.clinical_record / postal_code de la contrapartida.
--
-- fn_ingest_invoice pasa a ser un envoltorio de la versión anterior
-- (fn_ingest_invoice_base): mismo contrato, y si la factura ya existía y se
-- ha completado algo, el resultado 'sin_cambios' pasa a 'completada'.

-- ── Líneas: inmutables salvo rellenar la descripción vacía ─────────────────
create or replace function erp.invoice_lines_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.description is null and new.description is not null
     and (new.id, new.invoice_id, new.line_no, new.base, new.vat_rate, new.vat_amount, new.vat_exempt_reason,
          new.withholding_rate, new.withholding_amount, new.account_code)
         is not distinct from
         (old.id, old.invoice_id, old.line_no, old.base, old.vat_rate, old.vat_amount, old.vat_exempt_reason,
          old.withholding_rate, old.withholding_amount, old.account_code) then
    return new;
  end if;
  raise exception '% es inmutable: corrige con un asiento/registro de rectificación', tg_table_name
    using errcode = 'P0001';
end;
$$;

drop trigger invoice_lines_immutable on erp.invoice_lines;
create trigger invoice_lines_immutable
  before update or delete on erp.invoice_lines
  for each row execute function erp.invoice_lines_guard();

-- ── Completar datos vacíos de una factura existente ────────────────────────
-- Devuelve cuántos datos se han completado (0 si no había nada que añadir).
create or replace function erp.fn_fill_invoice_gaps(p_invoice uuid, p jsonb)
returns integer
language plpgsql
as $$
declare
  v_inv erp.invoices;
  v_n integer := 0;
  v_rows integer;
begin
  select * into v_inv from erp.invoices where id = p_invoice;
  if not found then
    return 0;
  end if;

  -- Descripción de cada línea: misma posición y mismos importes.
  update erp.invoice_lines l
     set description = nullif(trim(x.l->>'description'), '')
    from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) with ordinality as x(l, ord)
   where l.invoice_id = p_invoice
     and l.line_no = x.ord
     and l.description is null
     and nullif(trim(x.l->>'description'), '') is not null
     and l.base = round((x.l->>'base')::numeric, 2)
     and l.vat_amount = round(coalesce((x.l->>'vat_amount')::numeric, 0), 2);
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  -- Contrapartida: nº de historia y código postal si estaban vacíos.
  update erp.parties set
    clinical_record = coalesce(clinical_record, nullif(trim(p->'counterparty'->>'clinical_record'), '')),
    postal_code = coalesce(postal_code, nullif(trim(p->'counterparty'->>'postal_code'), ''))
  where id = v_inv.counterparty_id
    and ((clinical_record is null and nullif(trim(p->'counterparty'->>'clinical_record'), '') is not null)
      or (postal_code is null and nullif(trim(p->'counterparty'->>'postal_code'), '') is not null));
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  return v_n;
end;
$$;

alter function erp.fn_ingest_invoice(jsonb, uuid, uuid) rename to fn_ingest_invoice_base;

create or replace function erp.fn_ingest_invoice(p jsonb, p_run uuid, p_doc uuid)
returns jsonb
language plpgsql
as $$
declare
  v_res jsonb := erp.fn_ingest_invoice_base(p, p_run, p_doc);
begin
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

revoke execute on all functions in schema erp from public, anon, authenticated;
grant execute on all functions in schema erp to service_role;
