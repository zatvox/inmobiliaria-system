-- ============================================================================
-- 20_migrations-contrato-multi-seccion.sql
-- Caso real: un inquilino toma varias secciones bajo UN mismo contrato (ej.
-- 4to y 5to piso de Edificio Polonia) y más adelante amplía tomando una
-- sección más (6to piso). En el rubro inmobiliario esto se maneja con una
-- "adenda": un anexo que amplía el contrato original (mismo inquilino, mismo
-- número de contrato) detallando el inmueble adicional, su propia mensualidad
-- y sus propias fechas de inicio/fin — sin anular ni re-firmar el contrato
-- original. Esta migración modela justamente eso.
--
-- contratos_alquiler.seccion_id se mantiene (apunta siempre a la sección
-- ORIGINAL, la del contrato inicial) solo por compatibilidad con vistas que
-- ya lo usan como referencia rápida. La fuente de verdad de QUÉ secciones
-- cubre el contrato — y con qué renta/fechas cada una — es la tabla nueva
-- contratos_alquiler_secciones. contratos_alquiler.monto_renta pasa a ser
-- la SUMA de todas sus secciones (se valida/calcula desde el frontend).
-- ============================================================================

create table if not exists contratos_alquiler_secciones (
  id uuid primary key default gen_random_uuid(),
  contrato_alquiler_id uuid not null references contratos_alquiler(id) on delete cascade,
  seccion_id uuid not null references secciones(id),
  monto_renta numeric(12,2) not null,
  fecha_inicio date not null,
  fecha_fin date,
  es_adenda boolean not null default false,
  numero_adenda int,
  notas text,
  created_at timestamptz not null default now(),
  unique (contrato_alquiler_id, seccion_id)
);
create index idx_cas_contrato on contratos_alquiler_secciones(contrato_alquiler_id);
create index idx_cas_seccion on contratos_alquiler_secciones(seccion_id);

alter table contratos_alquiler_secciones enable row level security;

drop policy if exists contratos_secciones_read on contratos_alquiler_secciones;
create policy contratos_secciones_read on contratos_alquiler_secciones
  for select using (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_secciones_insert on contratos_alquiler_secciones;
create policy contratos_secciones_insert on contratos_alquiler_secciones
  for insert with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_secciones_update on contratos_alquiler_secciones;
create policy contratos_secciones_update on contratos_alquiler_secciones
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_secciones_delete on contratos_alquiler_secciones;
create policy contratos_secciones_delete on contratos_alquiler_secciones
  for delete using (auth_rol() in ('administrador','operador'));

-- Backfill: todo contrato de alquiler que ya existía se registra como su
-- propia "sección original" (es_adenda = false), usando los datos que ya
-- tenía en sus columnas seccion_id / monto_renta / fecha_inicio / fecha_fin.
-- Idempotente: no duplica si se corre más de una vez.
insert into contratos_alquiler_secciones (contrato_alquiler_id, seccion_id, monto_renta, fecha_inicio, fecha_fin, es_adenda, numero_adenda)
select ca.id, ca.seccion_id, ca.monto_renta, ca.fecha_inicio, ca.fecha_fin, false, null
from contratos_alquiler ca
where not exists (
  select 1 from contratos_alquiler_secciones cas where cas.contrato_alquiler_id = ca.id
);

-- ----------------------------------------------------------------------------
-- Trigger: al vincular una sección a un contrato (insertar en
-- contratos_alquiler_secciones), si el contrato está vigente/por_vencer, esa
-- sección pasa a 'alquilado' de inmediato. Cubre tanto la sección original
-- (insertada justo después de crear el contrato) como cualquier adenda
-- posterior agregada mientras el contrato ya está vigente.
-- ----------------------------------------------------------------------------
create or replace function trg_fn_contrato_alquiler_seccion_creada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_contrato text;
begin
  select estado into v_estado_contrato from contratos_alquiler where id = new.contrato_alquiler_id;
  if v_estado_contrato in ('vigente', 'por_vencer') then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_alquiler_seccion_creada on contratos_alquiler_secciones;
create trigger trg_contrato_alquiler_seccion_creada
  after insert on contratos_alquiler_secciones
  for each row execute function trg_fn_contrato_alquiler_seccion_creada();

-- Trigger: si se quita una sección de un contrato (ej. se corrigió una fila
-- agregada por error), la sección vuelve a 'disponible' — pero solo si
-- ningún OTRO contrato vigente la sigue reclamando (evita liberar una
-- sección que en realidad sigue ocupada por otro contrato).
create or replace function trg_fn_contrato_alquiler_seccion_eliminada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update secciones set estado = 'disponible'
  where id = old.seccion_id and estado = 'alquilado'
    and not exists (
      select 1 from contratos_alquiler_secciones cas
      join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
      where cas.seccion_id = old.seccion_id and ca.estado in ('vigente', 'por_vencer')
    );
  return old;
end;
$$;

drop trigger if exists trg_contrato_alquiler_seccion_eliminada on contratos_alquiler_secciones;
create trigger trg_contrato_alquiler_seccion_eliminada
  after delete on contratos_alquiler_secciones
  for each row execute function trg_fn_contrato_alquiler_seccion_eliminada();

-- ----------------------------------------------------------------------------
-- El trigger existente de contratos_alquiler (creado/estado) seguía marcando
-- SOLO new.seccion_id (la original) como 'alquilado'/'disponible'. Se
-- actualiza para que, al finalizar un contrato, libere TODAS sus secciones
-- (no solo la original) — la marca inicial de 'alquilado' ya la cubre el
-- trigger nuevo de arriba en cuanto se inserta cada fila.
-- ----------------------------------------------------------------------------
create or replace function trg_fn_contrato_alquiler_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('vigente', 'por_vencer') then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
    perform generar_cuotas_alquiler(new.id);
  elsif new.estado = 'finalizado' then
    update secciones set estado = 'disponible'
    where estado = 'alquilado'
      and id in (
        select seccion_id from contratos_alquiler_secciones where contrato_alquiler_id = new.id
        union
        select new.seccion_id
      );
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
