-- Excel trimestral del gestor.
--
-- 1) Datos tal como figuran en cada documento (los necesita el Excel):
--    · invoices.bill_to_*: nombre, documento y código postal de la factura
--      emitida. La ficha del paciente (parties) se crea con la primera factura
--      y no sirve: quien paga puede ser otro (madre/padre) o escribirse distinto.
--    · balance_snapshot_lines: una línea por paciente del listado de saldos,
--      con su nombre, documento, teléfono y CP. Antes se agrupaba por ficha y
--      dos pacientes con el mismo documento (hermanos con el DNI de la madre)
--      se sumaban en una línea con el nombre de la ficha.
--    Las facturas y fotos ya cargadas se completan al volver a subir los
--    listados (fn_fill_invoice_gaps / nueva foto de saldos).
-- 2) fn_gestor_export_data: todos los datos del Excel en una función, la
--    misma que usan los tests de regresión.
--
-- Se puede ejecutar más de una vez.

-- ── Datos de facturación por factura ───────────────────────────────────────
alter table erp.invoices add column if not exists bill_to_name text;
alter table erp.invoices add column if not exists bill_to_tax_id text;
alter table erp.invoices add column if not exists bill_to_postal_code text;

-- Una factura corregida conserva los datos de facturación de la original
-- (salvo que el dato entrante traiga los suyos: ver fn_ingest_invoice).
create or replace function erp.invoices_copy_bill_to()
returns trigger
language plpgsql
as $$
begin
  if new.corrects_invoice_id is not null and new.bill_to_name is null then
    select bill_to_name, bill_to_tax_id, bill_to_postal_code
      into new.bill_to_name, new.bill_to_tax_id, new.bill_to_postal_code
      from erp.invoices where id = new.corrects_invoice_id;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_copy_bill_to on erp.invoices;
create trigger invoices_copy_bill_to
  before insert on erp.invoices
  for each row execute function erp.invoices_copy_bill_to();

-- ── Completar datos vacíos (+ datos de facturación) ────────────────────────
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

  update erp.parties set postal_code = nullif(trim(p->'counterparty'->>'postal_code'), '')
   where id = v_inv.counterparty_id
     and postal_code is null
     and nullif(trim(p->'counterparty'->>'postal_code'), '') is not null;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  if p ? 'bill_to' and v_inv.bill_to_name is null and nullif(trim(p->'bill_to'->>'name'), '') is not null then
    update erp.invoices set
      bill_to_name = nullif(trim(p->'bill_to'->>'name'), ''),
      bill_to_tax_id = erp.norm_tax_id(p->'bill_to'->>'tax_id'),
      bill_to_postal_code = nullif(trim(p->'bill_to'->>'postal_code'), '')
    where id = p_invoice;
    v_n := v_n + 1;
  end if;

  return v_n;
end;
$$;

-- ── Ingesta: guarda los datos de facturación del documento ─────────────────
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
  if v_res->>'result' = 'insertada' and p ? 'bill_to' then
    update erp.invoices set
      bill_to_name = nullif(trim(p->'bill_to'->>'name'), ''),
      bill_to_tax_id = erp.norm_tax_id(p->'bill_to'->>'tax_id'),
      bill_to_postal_code = nullif(trim(p->'bill_to'->>'postal_code'), '')
    where id = (v_res->>'invoice_id')::uuid;
  end if;
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

-- ── Saldos: una línea por paciente del listado, con sus datos ──────────────
alter table erp.balance_snapshot_lines add column if not exists line_no integer;
alter table erp.balance_snapshot_lines add column if not exists name text;
alter table erp.balance_snapshot_lines add column if not exists tax_id text;
alter table erp.balance_snapshot_lines add column if not exists phone text;
alter table erp.balance_snapshot_lines add column if not exists postal_code text;

-- Fotos ya cargadas: nº de línea y datos de la ficha (lo único que había).
alter table erp.balance_snapshot_lines disable trigger balance_snapshot_lines_immutable;
update erp.balance_snapshot_lines l set line_no = x.n
  from (select snapshot_id, party_id,
               row_number() over (partition by snapshot_id order by abs(balance) desc, party_id) as n
          from erp.balance_snapshot_lines) x
 where l.snapshot_id = x.snapshot_id and l.party_id = x.party_id and l.line_no is null;
update erp.balance_snapshot_lines l set name = p.name, tax_id = p.tax_id, phone = p.phone, postal_code = p.postal_code
  from erp.parties p
 where p.id = l.party_id and l.name is null;
alter table erp.balance_snapshot_lines enable trigger balance_snapshot_lines_immutable;

alter table erp.balance_snapshot_lines alter column line_no set not null;
alter table erp.balance_snapshot_lines drop constraint if exists balance_snapshot_lines_pkey;
alter table erp.balance_snapshot_lines add constraint balance_snapshot_lines_pkey primary key (snapshot_id, line_no);
create index if not exists balance_snapshot_lines_party_idx on erp.balance_snapshot_lines (party_id);

-- {as_of, side, lines: [{tax_id, name, phone, postal_code, balance}]}
-- Misma foto (mismo día, lado y contenido) subida dos veces → sin cambios.
create or replace function erp.fn_ingest_balance_snapshot(p jsonb, p_run uuid, p_doc uuid)
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
  select row_number() over (order by x.ord) as line_no,
         erp.fn_upsert_party('paciente', x.l->>'tax_id', x.l->>'name', null,
                             x.l->>'postal_code', x.l->>'phone') as party_id,
         nullif(regexp_replace(trim(coalesce(x.l->>'name', '')), '\s+', ' ', 'g'), '') as name,
         erp.norm_tax_id(x.l->>'tax_id') as tax_id,
         nullif(trim(coalesce(x.l->>'phone', '')), '') as phone,
         nullif(trim(coalesce(x.l->>'postal_code', '')), '') as postal_code,
         round((x.l->>'balance')::numeric, 2) as balance
    from jsonb_array_elements(p->'lines') with ordinality as x(l, ord)
   where round((x.l->>'balance')::numeric, 2) <> 0;

  if v_side = 'acreedores' and exists (select 1 from _snap where balance < 0)
     or v_side = 'deudores' and exists (select 1 from _snap where balance > 0) then
    raise exception 'El listado de % contiene saldos del signo contrario', v_side using errcode = 'P0006';
  end if;

  select encode(sha256(convert_to(coalesce(string_agg(
                concat_ws(':', coalesce(tax_id, ''), coalesce(name, ''), to_char(balance, 'FM999999999990.00')),
                ';' order by line_no), ''), 'UTF8')), 'hex'),
         coalesce(sum(balance), 0), count(*)
    into v_hash, v_total, v_n
    from _snap;

  insert into erp.balance_snapshots (as_of, side, sync_run_id, source_document_id, content_hash, total, patients)
  values (v_as_of, v_side, p_run, p_doc, v_hash, v_total, v_n)
  on conflict (as_of, side, content_hash) do nothing
  returning id into v_id;

  if v_id is null then
    drop table _snap;
    return jsonb_build_object('result', 'sin_cambios', 'total', v_total, 'patients', v_n);
  end if;

  insert into erp.balance_snapshot_lines (snapshot_id, line_no, party_id, balance, name, tax_id, phone, postal_code)
  select v_id, line_no, party_id, balance, name, tax_id, phone, postal_code from _snap;
  drop table _snap;
  return jsonb_build_object('result', 'insertada', 'snapshot_id', v_id, 'total', v_total, 'patients', v_n);
end;
$$;

-- ── Datos del Excel trimestral ─────────────────────────────────────────────
-- Una fila por LÍNEA de factura, como el listado de Optimydent y el Excel que
-- ya se entregaba. Saldos: por cada lado, la foto más reciente tomada desde el
-- inicio del trimestre hasta 60 días después de su cierre.
create or replace function erp.fn_gestor_export_data(p_year integer, p_quarter integer)
returns jsonb
language plpgsql
stable
as $$
declare
  v_from date;
  v_to date;
  v_snap_a erp.balance_snapshots;
  v_snap_d erp.balance_snapshots;
begin
  if p_quarter not between 1 and 4 then
    raise exception 'Trimestre no válido' using errcode = 'P0006';
  end if;
  v_from := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_to := (v_from + interval '3 months' - interval '1 day')::date;

  select * into v_snap_a from erp.balance_snapshots
   where side = 'acreedores' and as_of between v_from and v_to + 60
   order by as_of desc, created_at desc limit 1;
  select * into v_snap_d from erp.balance_snapshots
   where side = 'deudores' and as_of between v_from and v_to + 60
   order by as_of desc, created_at desc limit 1;

  return jsonb_build_object(
    'year', p_year,
    'quarter', p_quarter,
    'from', v_from,
    'to', v_to,
    'ingresos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invoice_id', i.id, 'line_no', l.line_no, 'source', i.source, 'kind', p.kind,
               'fecha', i.issue_date, 'numero', i.invoice_number,
               'doc', coalesce(i.bill_to_tax_id, p.tax_id),
               'razon', coalesce(i.bill_to_name, p.name),
               'cp', case when i.bill_to_name is not null then i.bill_to_postal_code else p.postal_code end,
               'base', l.base, 'impuestos', l.vat_amount,
               'forma_pago', i.payment_method, 'fecha_pago', i.paid_at)
             order by i.issue_date, i.invoice_number, l.line_no)
        from erp.invoices i
        join erp.invoice_lines l on l.invoice_id = i.id
        join erp.parties p on p.id = i.counterparty_id
       where i.direction = 'emitida' and i.status <> 'anulada' and i.issue_date between v_from and v_to), '[]'::jsonb),
    'gastos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'invoice_id', i.id, 'line_no', l.line_no, 'source', i.source,
               'con_retencion', i.withholding_total <> 0,
               'fecha', i.issue_date, 'factura', i.invoice_number,
               'cif', i.issuer_tax_id, 'razon', i.issuer_name, 'tipo_gasto', t.name,
               'forma_pago', i.payment_method,
               'base', l.base, 'impuestos', l.vat_amount, 'vat_rate', l.vat_rate,
               'exento', l.vat_exempt_reason, 'tasa_ret', l.withholding_rate, 'retencion', l.withholding_amount,
               'asiento', l.account_code)
             order by i.issue_date, i.invoice_number, l.line_no)
        from erp.invoices i
        join erp.invoice_lines l on l.invoice_id = i.id
        left join erp.expense_types t on t.id = i.expense_type_id
       where i.direction = 'recibida' and i.status <> 'anulada' and i.issue_date between v_from and v_to), '[]'::jsonb),
    'saldos', jsonb_build_object(
      'acreedores_as_of', v_snap_a.as_of,
      'deudores_as_of', v_snap_d.as_of,
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nombre', coalesce(sl.name, p.name), 'doc', coalesce(sl.tax_id, p.tax_id),
                 'telefono', coalesce(sl.phone, p.phone), 'cp', coalesce(sl.postal_code, p.postal_code),
                 'saldo', sl.balance)
                 order by sl.snapshot_id, sl.line_no)
          from erp.balance_snapshot_lines sl
          join erp.parties p on p.id = sl.party_id
         where sl.snapshot_id in (v_snap_a.id, v_snap_d.id)), '[]'::jsonb)),
    'controles', jsonb_build_object(
      'revision', (select count(*) from erp.invoices
                    where needs_review and status <> 'anulada' and issue_date between v_from and v_to),
      'conflictos', (select count(*) from erp.ingest_conflicts c
                       join erp.invoices e on e.id = c.existing_invoice_id
                      where c.resolution = 'pendiente' and e.issue_date between v_from and v_to),
      'cerrado', exists (select 1 from erp.tax_periods
                          where year = p_year and quarter = p_quarter and status = 'cerrado'),
      'emitidas_hasta', (select max(covers_to) from erp.source_documents where kind = 'optimydent_facturas_emitidas'),
      'gastos_hasta', (select max(covers_to) from erp.source_documents where kind = 'optimydent_gastos'))
  );
end;
$$;

revoke execute on all functions in schema erp from public, anon, authenticated;
grant execute on all functions in schema erp to service_role;
