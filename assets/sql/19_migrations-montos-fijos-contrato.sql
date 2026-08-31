-- ============================================================================
-- 19_migrations-montos-fijos-contrato.sql
-- Caso "Edificio Polonia": algunos locales tienen medidor propio de agua/luz
-- y otros pagan un monto fijo mensual (definido en el CONTRATO de alquiler,
-- porque depende de cuántas personas van a habitar/trabajar ahí — es un
-- dato que ya se negocia y se estipula al firmar, junto con la renta). No
-- es un default global igual para todos los locales: cada contrato puede
-- tener un monto fijo distinto por tipo de servicio (agua, luz, etc.).
-- ============================================================================

-- Dato de contexto del contrato (informativo, y referencia para negociar el
-- monto fijo) — no se usa para recalcular nada automáticamente.
alter table contratos_alquiler add column if not exists n_ocupantes int;

create table if not exists contratos_alquiler_servicios_fijos (
  id uuid primary key default gen_random_uuid(),
  contrato_alquiler_id uuid not null references contratos_alquiler(id) on delete cascade,
  tipo_servicio_id uuid not null references tipos_servicio(id),
  monto_fijo numeric(12,2) not null,
  notas text,
  created_at timestamptz not null default now(),
  unique (contrato_alquiler_id, tipo_servicio_id)
);
create index idx_contratos_servicios_fijos_contrato on contratos_alquiler_servicios_fijos(contrato_alquiler_id);

alter table contratos_alquiler_servicios_fijos enable row level security;

drop policy if exists contratos_servicios_fijos_read on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_read on contratos_alquiler_servicios_fijos
  for select using (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_servicios_fijos_write on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_write on contratos_alquiler_servicios_fijos
  for insert with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_servicios_fijos_update on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_update on contratos_alquiler_servicios_fijos
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_servicios_fijos_delete on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_delete on contratos_alquiler_servicios_fijos
  for delete using (auth_rol() in ('administrador','operador'));

-- Permite guardar el detalle de cálculo de una sección con monto fijo como
-- su propio método ('monto_fijo'), distinto de 'tarifa_fija_por_persona'
-- (que era un default global igual para todos, y ya no se usa para esto) —
-- se sigue guardando como n_personas=1 / tarifa_por_persona=monto para no
-- tener que tocar la función calcular_periodo_servicio, que ya sabe hacer
-- monto = n_personas * tarifa_por_persona.
do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'calculo_servicios_detalle' and att.attname = 'metodo' and con.contype = 'c';
  if v_constraint_name is not null then
    execute format('alter table calculo_servicios_detalle drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table calculo_servicios_detalle
  add constraint calculo_servicios_detalle_metodo_check
  check (metodo in ('medidor', 'tarifa_fija_por_persona', 'monto_fijo'));

notify pgrst, 'reload schema';
