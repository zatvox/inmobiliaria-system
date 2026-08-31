-- ============================================================================
-- 22_diagnostico-y-fix-definitivo-multiseccion.sql
--
-- No tengo acceso directo a tu Supabase ni a tu live server desde este
-- entorno (no hay credenciales reales en config.js y no puedo alcanzar
-- 127.0.0.1 desde aquí) — así que este script hace dos cosas a la vez:
-- 1) DIAGNÓSTICO: te dice exactamente por qué Piso 5 sigue sin nombre y
--    separado de Piso 4 (imprime los resultados con RAISE NOTICE).
-- 2) FIX: repara calculo_servicios_detalle.contrato_alquiler_id SIN la
--    restricción "cuota_id is null" que tenía el script 21b (esa
--    restricción era innecesaria y pudo ser la causa de que no se
--    actualizara si lo corriste en el momento equivocado).
--
-- Ejecuta esto completo en el SQL Editor de Supabase. Léelo con "Ver logs"
-- o "Messages" para ver los NOTICE — ahí está el diagnóstico real de tu caso.
-- Luego, en Cobranzas: elimina las 2 cuotas de Piso 4 / Piso 5 y dale
-- "Generar cobranzas del periodo" de nuevo para Polonia / Agua / 2026-08.
-- ============================================================================

do $$
declare
  r record;
  v_total int := 0;
begin
  raise notice '--- DIAGNÓSTICO: secciones de Polonia SJL1 con "Piso" en el nombre ---';
  for r in
    select s.id as seccion_id, s.nombre as seccion_nombre, p.nombre_referencial as propiedad
    from secciones s
    join propiedades p on p.id = s.propiedad_id
    where s.nombre ilike '%piso%' and p.nombre_referencial ilike '%polon%'
  loop
    raise notice 'sección % (%) -> id %', r.seccion_nombre, r.propiedad, r.seccion_id;
  end loop;

  raise notice '--- DIAGNÓSTICO: filas en contratos_alquiler_secciones para esas secciones ---';
  for r in
    select cas.seccion_id, s.nombre as seccion_nombre, cas.contrato_alquiler_id,
           ca.estado as contrato_estado, ca.fecha_inicio, cas.es_adenda
    from contratos_alquiler_secciones cas
    join secciones s on s.id = cas.seccion_id
    join propiedades p on p.id = s.propiedad_id
    join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
    where p.nombre_referencial ilike '%polon%' and s.nombre ilike '%piso%'
  loop
    raise notice 'sección % -> contrato % (estado=%, adenda=%)', r.seccion_nombre, r.contrato_alquiler_id, r.contrato_estado, r.es_adenda;
  end loop;

  raise notice '--- DIAGNÓSTICO: calculo_servicios_detalle actual (periodo 2026-08, Polonia, Agua) ---';
  for r in
    select d.id as detalle_id, s.nombre as seccion_nombre, d.contrato_alquiler_id, d.cuota_id, d.monto_calculado
    from calculo_servicios_detalle d
    join calculo_servicios_periodo cp on cp.id = d.calculo_periodo_id
    join secciones s on s.id = d.seccion_id
    join propiedades p on p.id = s.propiedad_id
    where p.nombre_referencial ilike '%polon%' and s.nombre ilike '%piso%' and cp.periodo = '2026-08'
  loop
    raise notice 'detalle % sección % -> contrato_alquiler_id=% cuota_id=% monto=%', r.detalle_id, r.seccion_nombre, r.contrato_alquiler_id, r.cuota_id, r.monto_calculado;
  end loop;

  raise notice '--- APLICANDO FIX (sin filtro de cuota_id) ---';
  with sub as (
    select distinct on (cas.seccion_id) cas.seccion_id, ca.id as contrato_id
    from contratos_alquiler_secciones cas
    join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
    where ca.estado in ('vigente', 'por_vencer')
    order by cas.seccion_id, ca.fecha_inicio desc
  )
  update calculo_servicios_detalle d
  set contrato_alquiler_id = sub.contrato_id
  from sub
  where d.seccion_id = sub.seccion_id
    and d.contrato_alquiler_id is distinct from sub.contrato_id;

  get diagnostics v_total = row_count;
  raise notice 'filas de calculo_servicios_detalle actualizadas: %', v_total;

  raise notice '--- DIAGNÓSTICO FINAL: calculo_servicios_detalle después del fix ---';
  for r in
    select d.id as detalle_id, s.nombre as seccion_nombre, d.contrato_alquiler_id, d.cuota_id
    from calculo_servicios_detalle d
    join calculo_servicios_periodo cp on cp.id = d.calculo_periodo_id
    join secciones s on s.id = d.seccion_id
    join propiedades p on p.id = s.propiedad_id
    where p.nombre_referencial ilike '%polon%' and s.nombre ilike '%piso%' and cp.periodo = '2026-08'
  loop
    raise notice 'detalle % sección % -> contrato_alquiler_id=% cuota_id=%', r.detalle_id, r.seccion_nombre, r.contrato_alquiler_id, r.cuota_id;
  end loop;
end $$;
