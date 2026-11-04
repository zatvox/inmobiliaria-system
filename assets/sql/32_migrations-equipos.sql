-- NOTA: la base ya tenía una tabla 'equipos' ajena a este módulo (sin propiedad_id);
-- por eso esta migración usa el nombre propio 'equipos_edificio' y no toca la otra.
-- ============================================================================
-- 32 · Equipos por edificio (motobombas, tanques, ascensores, tableros…)
--  · equipos_edificio: inventario por propiedad (y sección opcional) con marca/modelo,
--    garantía, estado y frecuencia de mantenimiento preventivo (meses).
--  · mantenimientos.equipo_id: vincula cada trabajo (carpeta) a su equipo, para
--    ver historial, costo acumulado y próximo mantenimiento.
-- Requiere el SQL 31. Re-ejecutable.
-- ============================================================================
create table if not exists equipos_edificio (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id),
  seccion_id uuid references secciones(id),
  nombre text not null,                                  -- "Motobomba 1er piso"
  categoria text,                                        -- Bombeo, Eléctrico, Agua, Ascensor…
  ubicacion text,
  marca text,
  modelo text,
  nro_serie text,
  fecha_instalacion date,
  garantia_hasta date,
  frecuencia_mant_meses int check (frecuencia_mant_meses is null or frecuencia_mant_meses > 0),
  estado text not null default 'operativo' check (estado in ('operativo','en_mantenimiento','fuera_de_servicio','dado_de_baja')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_equipos_edificio_propiedad on equipos_edificio(propiedad_id);
drop trigger if exists trg_equipos_edificio_updated on equipos_edificio;
create trigger trg_equipos_edificio_updated before update on equipos_edificio for each row execute function set_updated_at();

alter table mantenimientos add column if not exists equipo_id uuid references equipos_edificio(id) on delete set null;
create index if not exists idx_mant_equipo on mantenimientos(equipo_id);

alter table equipos_edificio enable row level security;
drop policy if exists equipos_edificio_rw on equipos_edificio;
create policy equipos_edificio_rw on equipos_edificio for all
  using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
drop policy if exists dev_anon_all on equipos_edificio;
create policy dev_anon_all on equipos_edificio for all to anon using (true) with check (true);
