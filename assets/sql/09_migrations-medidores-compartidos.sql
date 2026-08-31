-- ============================================================================
-- migrations-medidores-compartidos.sql
-- Soporta medidores compartidos por varias secciones (ej. un baño común
-- usado por 2 locales, que se dividen el consumo por porcentaje).
--
-- Antes: cada medidor (no general) pertenecía a UNA sola sección.
-- Ahora: un medidor puede marcarse "compartido" y repartirse entre 2+
-- secciones, cada una con su propio porcentaje (deben sumar 100%). Al
-- calcular el servicio, ese medidor genera una cuota por cada sección del
-- reparto, con el consumo del periodo multiplicado por su porcentaje.
-- No afecta medidores existentes — todos siguen con es_compartido = false.
-- ============================================================================

alter table medidores
  add column if not exists es_compartido boolean not null default false;

-- Reemplaza chk_medidor_dueno para permitir el 3er caso: compartido (sin
-- seccion_id propia, se reparte via medidores_reparto).
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'medidores'::regclass and contype = 'c' and conname = 'chk_medidor_dueno';
  if v_name is not null then
    execute format('alter table medidores drop constraint %I', v_name);
  end if;
end $$;

alter table medidores add constraint chk_medidor_dueno check (
  (es_general = true  and propiedad_id is not null and seccion_id is null and es_compartido = false)
  or
  (es_general = false and es_compartido = false and seccion_id is not null)
  or
  (es_general = false and es_compartido = true  and seccion_id is null and propiedad_id is not null)
);

create table medidores_reparto (
  id uuid primary key default gen_random_uuid(),
  medidor_id uuid not null references medidores(id) on delete cascade,
  seccion_id uuid not null references secciones(id),
  porcentaje numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  created_at timestamptz not null default now(),
  unique (medidor_id, seccion_id)
);
create index idx_medidores_reparto_medidor on medidores_reparto(medidor_id);
create index idx_medidores_reparto_seccion on medidores_reparto(seccion_id);

alter table medidores_reparto enable row level security;

create policy medidores_reparto_read on medidores_reparto
  for select using (auth_rol() in ('administrador','operador'));
create policy medidores_reparto_write on medidores_reparto
  for insert with check (auth_rol() in ('administrador','operador'));
create policy medidores_reparto_update on medidores_reparto
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy medidores_reparto_delete on medidores_reparto
  for delete using (auth_rol() in ('administrador','operador'));
