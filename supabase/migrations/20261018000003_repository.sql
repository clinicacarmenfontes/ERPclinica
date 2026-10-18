-- ═══════════════════════════════════════════════════════════════════════════
-- Paso 3b · Repositorio de facturas (OneDrive de info@) + lectura con Claude
-- BAJO DEMANDA (el flujo principal son los listados de Optimydent).
--
-- Estructura real de la carpeta "01. Facturas":
--   04. 2026/3er Trimestre/                   → llegadas, aún sin picar en Optimydent
--   04. 2026/3er Trimestre/PICADAS/           → ya introducidas en Optimydent (justificante)
--   04. 2026/3er Trimestre/Facturas con retención/  → doctoras (no están en Optimydent)
--   04. 2026/2º Trimestre/Facturas emitidas SLP…/   → emitidas a otras clínicas
-- El ROL de cada fichero sale de su carpeta; los datos, de leerlo con Claude.
-- ═══════════════════════════════════════════════════════════════════════════

-- Tokens de integraciones (refresh token de Microsoft Graph, cifrado en la app
-- con AES-256-GCM; la BBDD nunca ve el valor en claro).
create table public.integration_tokens (
  provider text primary key check (provider in ('microsoft_graph')),
  account_email text not null,
  refresh_token_enc text not null,
  scopes text not null,
  -- Carpeta compartida resuelta (driveId/itemId) para no resolverla cada vez.
  state jsonb not null default '{}'::jsonb,
  last_error text,
  updated_at timestamptz not null default now()
);

create trigger integration_tokens_set_updated_at
  before update on public.integration_tokens
  for each row execute function public.set_updated_at();

-- Inventario de la carpeta. Mutable: si mueves un fichero de la raíz a PICADAS
-- cambia su ruta y su rol (el contenido sigue en source_documents, inmutable).
create table public.repository_items (
  drive_item_id text primary key,
  drive_id text not null,
  path text not null,                               -- relativa a "01. Facturas"
  name text not null,
  etag text,
  size bigint,
  last_modified timestamptz,
  year smallint,
  quarter smallint check (quarter between 1 and 4),
  role text not null check (role in (
    'registrada_optimydent',   -- PICADAS / "metidas en el programa": debe existir en Optimydent
    'pendiente_registrar',     -- raíz del trimestre, "anterior trimestre no metidas"…
    'profesional',             -- facturas con retención (doctoras)
    'emitida',                 -- facturas emitidas por la SLP a otras clínicas
    'ignorado'                 -- transferencias, zip, xlsx…
  )),
  status text not null default 'nuevo' check (status in ('nuevo', 'procesado', 'ignorado', 'error')),
  -- cTag de Graph: cambia solo si cambia el CONTENIDO (no al mover/renombrar).
  ctag text,
  -- Intentos de lectura con Claude (informativo: solo se lee cuando lo pides).
  attempts smallint not null default 0,
  source_document_id uuid references public.source_documents (id),
  error text,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index repository_items_status_idx on public.repository_items (status);
create index repository_items_doc_idx on public.repository_items (source_document_id);

create trigger repository_items_set_updated_at
  before update on public.repository_items
  for each row execute function public.set_updated_at();

-- Bandeja: datos de contexto para revisar cada lectura.
alter table public.document_extractions
  add column folder_role text,
  add column repository_path text,
  add column match_candidates jsonb not null default '[]'::jsonb,
  add column review_reasons text[] not null default '{}';

create index document_extractions_pending_idx on public.document_extractions (created_at) where status = 'pendiente';

-- Contabilizar desde la bandeja puede chocar con una factura existente sin
-- que haya una sincronización en marcha.
alter table public.ingest_conflicts alter column sync_run_id drop not null;

alter table public.ai_runs drop constraint ai_runs_purpose_check;
alter table public.ai_runs add constraint ai_runs_purpose_check
  check (purpose in ('extraccion', 'clasificacion', 'recurrencia', 'anomalias', 'conciliacion'));

-- ── Emparejar una lectura con facturas existentes ──────────────────────────
-- Devuelve hasta 3 candidatas con puntuación 0..1. El nº de factura se compara
-- solo por letras y cifras ("177/1" = "177-1"), y el emisor no es imprescindible:
-- en Optimydent hay proveedores grabados con el CIF de la clínica.
create or replace function public.fn_match_extraction(p jsonb)
returns jsonb
language sql
stable
as $$
  with input as (
    select p->>'direction' as direction,
           public.issuer_key_of(p->>'issuer_tax_id', p->>'issuer_name') as issuer_key,
           regexp_replace(upper(coalesce(p->>'invoice_number', '')), '[^A-Z0-9]', '', 'g') as num,
           (p->>'issue_date')::date as d,
           round((p->>'total')::numeric, 2) as total,
           upper(split_part(trim(coalesce(p->>'issuer_name', '')), ' ', 1)) as first_word
  ),
  cand as (
    select i.id, i.invoice_number, i.issuer_name, i.issue_date, i.total,
      least(1,
          case when x.num <> '' and regexp_replace(i.invoice_number_norm, '[^A-Z0-9]', '', 'g') = x.num then 0.5 else 0 end
        + case when abs(i.total - x.total) <= 0.01 then 0.3 else 0 end
        + case when i.issue_date = x.d then 0.15 when abs(i.issue_date - x.d) <= 3 then 0.05 else 0 end
        + case when i.issuer_key = x.issuer_key then 0.15
               when x.first_word <> '' and upper(i.issuer_name) like x.first_word || '%' then 0.05 else 0 end
      ) as score
    from public.invoices i, input x
    where i.status <> 'anulada'
      and i.direction = x.direction
      and (
        (x.num <> '' and regexp_replace(i.invoice_number_norm, '[^A-Z0-9]', '', 'g') = x.num)
        or (abs(i.total - x.total) <= 0.01 and i.issue_date between x.d - 10 and x.d + 10)
      )
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.score desc), '[]'::jsonb)
  from (select * from cand order by score desc limit 3) c;
$$;

-- Vincular como justificante (no crea nada contable).
create or replace function public.fn_link_extraction(p_extraction uuid, p_invoice uuid, p_actor text)
returns void
language plpgsql
as $$
declare
  v_e public.document_extractions;
begin
  select * into v_e from public.document_extractions where id = p_extraction for update;
  if not found then
    raise exception 'Lectura % no encontrada', p_extraction using errcode = 'P0006';
  end if;
  if v_e.status in ('contabilizado', 'descartado') then
    raise exception 'Esta lectura ya está %', v_e.status using errcode = 'P0001';
  end if;
  update public.document_extractions
     set status = 'vinculado', matched_invoice_id = p_invoice, reviewed_at = now()
   where id = p_extraction;
  insert into public.invoice_documents (invoice_id, source_document_id, role)
  values (p_invoice, v_e.source_document_id, 'justificante') on conflict do nothing;
  if p_actor <> 'sistema' then
    insert into public.audit_log (actor, action, entity, entity_id, after)
    values (p_actor, 'vincular_justificante', 'document_extractions', p_extraction::text,
            jsonb_build_object('invoice_id', p_invoice));
  end if;
end;
$$;

-- Contabilizar una lectura = alta por el mismo pipeline antiduplicados.
-- Si resulta que la factura ya existía, queda vinculada como justificante.
create or replace function public.fn_book_extraction(p_extraction uuid, p_invoice jsonb, p_actor text)
returns jsonb
language plpgsql
as $$
declare
  v_e public.document_extractions;
  v_res jsonb;
begin
  select * into v_e from public.document_extractions where id = p_extraction for update;
  if not found then
    raise exception 'Lectura % no encontrada', p_extraction using errcode = 'P0006';
  end if;
  if v_e.status <> 'pendiente' then
    raise exception 'Esta lectura ya está %', v_e.status using errcode = 'P0001';
  end if;

  v_res := public.fn_ingest_invoice(p_invoice, null, v_e.source_document_id);

  if v_res->>'result' = 'insertada' then
    update public.document_extractions
       set status = 'contabilizado', created_invoice_id = (v_res->>'invoice_id')::uuid,
           corrected = p_invoice, reviewed_at = now()
     where id = p_extraction;
    insert into public.invoice_documents (invoice_id, source_document_id, role)
    values ((v_res->>'invoice_id')::uuid, v_e.source_document_id, 'justificante') on conflict do nothing;
  elsif v_res->>'result' in ('sin_cambios', 'actualizada') then
    update public.document_extractions set corrected = p_invoice where id = p_extraction;
    perform public.fn_link_extraction(p_extraction, (v_res->>'invoice_id')::uuid, p_actor);
  else
    -- conflicto / lápida / trimestre cerrado: la lectura sigue pendiente.
    update public.document_extractions set corrected = p_invoice where id = p_extraction;
  end if;

  insert into public.audit_log (actor, action, entity, entity_id, after)
  values (p_actor, 'contabilizar_lectura', 'document_extractions', p_extraction::text, v_res);
  return v_res;
end;
$$;

create or replace function public.fn_discard_extraction(p_extraction uuid, p_reason text, p_actor text)
returns void
language plpgsql
as $$
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica por qué se descarta' using errcode = 'P0005';
  end if;
  update public.document_extractions
     set status = 'descartado', discard_reason = trim(p_reason), reviewed_at = now()
   where id = p_extraction and status = 'pendiente';
  if not found then
    raise exception 'Solo se descartan lecturas pendientes' using errcode = 'P0001';
  end if;
  if p_actor <> 'sistema' then
    insert into public.audit_log (actor, action, entity, entity_id, reason)
    values (p_actor, 'descartar_lectura', 'document_extractions', p_extraction::text, trim(p_reason));
  end if;
end;
$$;

-- Facturas recibidas de Optimydent que aún no tienen el PDF en OneDrive.
create view public.v_invoices_without_receipt as
select i.id, i.issue_date, i.issuer_name, i.issuer_tax_id, i.invoice_number, i.total
from public.invoices i
where i.direction = 'recibida' and i.status <> 'anulada' and i.source = 'optimydent'
  and not exists (select 1 from public.invoice_documents d
                   where d.invoice_id = i.id and d.role = 'justificante');

do $$
declare
  t text;
begin
  foreach t in array array['integration_tokens', 'repository_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;
revoke all on public.v_invoices_without_receipt from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
