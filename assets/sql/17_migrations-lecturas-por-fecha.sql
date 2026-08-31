-- ============================================================================
-- 17_migrations-lecturas-por-fecha.sql
-- Las lecturas de agua/luz no se toman en fechas de corte de mes calendario
-- (agua el 10, luz el 19 de cada mes, alineado a la fecha real en que el
-- proveedor toma su propia lectura) — obligar a elegir un "periodo" manual
-- para cada lectura era forzar un mes calendario a algo que en realidad es
-- un rango de fechas (ej. lectura del 10/08 en realidad mide el consumo del
-- 10/07 al 10/08). A partir de ahora la lógica gira en torno a las fechas
-- de lectura anterior/actual, encadenando cada lectura con la anterior por
-- FECHA (no por el string de periodo). `periodo` se sigue guardando (lo
-- necesitan Recibos generales y Cálculo de Servicios para agrupar por mes),
-- pero ya no lo elige el usuario: un trigger lo calcula solo, siempre, a
-- partir del mes de `fecha_lectura` (que ahora representa la fecha de la
-- lectura ACTUAL).
-- ============================================================================

alter table lecturas_medidores
  add column if not exists fecha_lectura_anterior date;

create or replace function set_periodo_desde_fecha_lectura()
returns trigger
language plpgsql
as $$
begin
  new.periodo := to_char(new.fecha_lectura, 'YYYY-MM');
  return new;
end;
$$;

drop trigger if exists trg_lecturas_periodo_auto on lecturas_medidores;
create trigger trg_lecturas_periodo_auto
  before insert or update on lecturas_medidores
  for each row execute function set_periodo_desde_fecha_lectura();

notify pgrst, 'reload schema';
