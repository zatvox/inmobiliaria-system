-- ============================================================================
-- migrations-configuracion-sistema.sql
-- Módulo de Configuración: variables globales editables desde la pantalla
-- (precio por defecto de agua/luz, moneda, mora, etc.) sin tocar código.
-- Tabla "singleton" — siempre existe UNA sola fila (id fijo = true), así el
-- formulario de Configuración solo hace un select/update, no un CRUD.
-- `extra` (jsonb) queda como cajón de sastre para variables futuras que no
-- ameriten una columna propia ni otra migración.
-- ============================================================================

create table if not exists configuracion_sistema (
  id boolean primary key default true,
  nombre_inmobiliaria text,
  precio_default_agua_m3 numeric(12,4),
  precio_default_luz_kwh numeric(12,4),
  moneda text not null default 'PEN',
  dias_gracia_mora int not null default 5,
  porcentaje_mora_mensual numeric(5,2) not null default 0,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint chk_configuracion_singleton check (id = true)
);

insert into configuracion_sistema (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_configuracion_updated on configuracion_sistema;
create trigger trg_configuracion_updated before update on configuracion_sistema
  for each row execute function set_updated_at();

alter table configuracion_sistema enable row level security;

drop policy if exists configuracion_select on configuracion_sistema;
create policy configuracion_select on configuracion_sistema for select
  using (auth_rol() in ('administrador', 'operador'));

drop policy if exists configuracion_update on configuracion_sistema;
create policy configuracion_update on configuracion_sistema for update
  using (auth_rol() = 'administrador')
  with check (auth_rol() = 'administrador');

notify pgrst, 'reload schema';
