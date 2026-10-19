-- Resolver lo que queda «para revisar» y cerrar trimestres desde la app.
--
--   · fn_set_expense_type: fija la cuenta y la partida de un tipo de gasto
--     (los «tipo de gasto nuevo» / «sin cuenta»). Sus facturas de trimestres
--     abiertos se reclasifican (salvo las tocadas a mano), las líneas sin
--     cuenta la reciben y pierden esos motivos de revisión.
--   · fn_close_tax_period / fn_reopen_tax_period: cierre (bloquea altas y
--     reclasificaciones del trimestre) y reapertura con motivo; ambos dejan
--     traza en tax_period_events.
--
-- Se puede ejecutar más de una vez.

-- ── Líneas: además de la descripción, se puede rellenar la cuenta vacía ────
create or replace function erp.invoice_lines_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and (old.description is not distinct from new.description
          or (old.description is null and new.description is not null))
     and (old.account_code is not distinct from new.account_code
          or (old.account_code is null and new.account_code is not null))
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

-- ── Cuenta y partida de un tipo de gasto ───────────────────────────────────
-- Devuelve cuántas facturas se han actualizado.
create or replace function erp.fn_set_expense_type(
  p_type uuid, p_account text, p_category uuid, p_actor text
) returns integer
language plpgsql
as $$
declare
  v_old erp.expense_types;
  v_n integer;
begin
  select * into v_old from erp.expense_types where id = p_type for update;
  if not found then
    raise exception 'Tipo de gasto % no encontrado', p_type using errcode = 'P0006';
  end if;
  if not exists (select 1 from erp.accounts where code = p_account and kind = 'gasto' and active) then
    raise exception 'La cuenta % no es una cuenta de gasto activa', p_account using errcode = 'P0006';
  end if;
  if p_category is null or not exists (select 1 from erp.expense_categories where id = p_category) then
    raise exception 'Elige una partida' using errcode = 'P0006';
  end if;

  update erp.expense_types set account_code = p_account, category_id = p_category, needs_review = false
   where id = p_type;

  -- Líneas sin cuenta de sus facturas vivas → la del tipo.
  update erp.invoice_lines l set account_code = p_account
    from erp.invoices i
   where l.invoice_id = i.id and i.expense_type_id = p_type and i.status <> 'anulada' and l.account_code is null;

  -- Facturas: partida (si no se tocó a mano y el trimestre está abierto) y
  -- fuera los motivos de revisión del tipo.
  with target as (
    select i.id,
           (coalesce(i.category_source, 'regla') <> 'manual'
             and not exists (select 1 from erp.tax_periods t
                              where t.year = i.fiscal_year and t.quarter = extract(quarter from i.issue_date)
                                and t.status = 'cerrado')) as reclassify,
           array(select r from unnest(i.review_reasons) r
                  where r not in ('tipo_gasto_nuevo', 'tipo_gasto_sin_cuenta')) as reasons
      from erp.invoices i
     where i.expense_type_id = p_type and i.status <> 'anulada'
  )
  update erp.invoices i set
    category_id = case when t.reclassify then p_category else i.category_id end,
    category_source = case when t.reclassify then 'regla' else i.category_source end,
    review_reasons = t.reasons,
    needs_review = cardinality(t.reasons) > 0
  from target t
  where i.id = t.id
    and (i.review_reasons is distinct from t.reasons
         or (t.reclassify and i.category_id is distinct from p_category));
  get diagnostics v_n = row_count;

  insert into erp.audit_log (actor, action, entity, entity_id, before, after)
  values (p_actor, 'editar_tipo_gasto', 'expense_types', p_type::text,
          jsonb_build_object('account_code', v_old.account_code, 'category_id', v_old.category_id),
          jsonb_build_object('account_code', p_account, 'category_id', p_category, 'facturas', v_n));
  return v_n;
end;
$$;

-- ── Cierre y reapertura de trimestre ───────────────────────────────────────
create or replace function erp.fn_close_tax_period(p_year integer, p_quarter integer, p_actor text)
returns void
language plpgsql
as $$
begin
  if p_quarter not between 1 and 4 then
    raise exception 'Trimestre no válido' using errcode = 'P0006';
  end if;
  if exists (select 1 from erp.tax_periods where year = p_year and quarter = p_quarter and status = 'cerrado') then
    raise exception 'El %T % ya está cerrado', p_quarter, p_year using errcode = 'P0001';
  end if;
  insert into erp.tax_periods (year, quarter, status, closed_at, closed_by)
  values (p_year, p_quarter, 'cerrado', now(), p_actor)
  on conflict (year, quarter) do update set status = 'cerrado', closed_at = now(), closed_by = p_actor;
  insert into erp.tax_period_events (year, quarter, action, actor) values (p_year, p_quarter, 'cerrado', p_actor);
end;
$$;

create or replace function erp.fn_reopen_tax_period(p_year integer, p_quarter integer, p_reason text, p_actor text)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from erp.tax_periods where year = p_year and quarter = p_quarter and status = 'cerrado') then
    raise exception 'El %T % no está cerrado', p_quarter, p_year using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Reabrir un trimestre exige un motivo (mín. 10 caracteres)' using errcode = 'P0005';
  end if;
  update erp.tax_periods set status = 'abierto', closed_at = null, closed_by = null
   where year = p_year and quarter = p_quarter;
  insert into erp.tax_period_events (year, quarter, action, reason, actor)
  values (p_year, p_quarter, 'reabierto', trim(p_reason), p_actor);
end;
$$;

revoke execute on all functions in schema erp from public, anon, authenticated;
grant execute on all functions in schema erp to service_role;
