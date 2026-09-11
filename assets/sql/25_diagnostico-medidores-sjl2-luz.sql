-- ============================================================================
-- 25_diagnostico-medidores-sjl2-luz.sql
-- Solo diagnóstico (no cambia nada) — para confirmar por qué la "Cuenta
-- Lt14" de Lotes Av. Santa Rosa de Lima (SJL2) solo muestra 1 medidor por
-- Lavadero en vez de los que ves en el selector de Lecturas.
--
-- Hipótesis: cada Lavadero (2 y 3) tiene DOS medidores de Luz, cada uno
-- asignado a una cuenta distinta (ej. "...Lt15 Lav2 interno" -> cuenta
-- Lt15, "...Lt14 Lav2 externo" -> cuenta Lt14) — eso es justamente lo que
-- hace la función "Cuentas de servicio": separar los medidores de una
-- propiedad en 2+ recibos independientes. Si es así, NO es un bug: cuando
-- calculas la cuenta "Lt14" es correcto que solo aparezca 1 medidor por
-- Lavadero (el de esa cuenta) — el otro medidor (de la cuenta "Lt15")
-- tendría que aparecer en su PROPIA tarjeta "Cuenta Lt15", que solo se
-- muestra si ya registraste un recibo general de Lt15 para este periodo en
-- la pestaña "Recibos generales".
-- ============================================================================

do $$
declare
  r record;
begin
  raise notice '--- Medidores de LUZ en Lotes Av. Santa Rosa de Lima (SJL2), agrupados por sección ---';
  for r in
    select s.nombre as seccion, m.codigo_medidor, m.id as medidor_id,
           m.cuenta_servicio_id, cs.codigo as cuenta_codigo, m.activo, m.es_compartido, m.es_general
    from medidores m
    join propiedades p on p.id = m.propiedad_id
    join tipos_servicio ts on ts.id = m.tipo_servicio_id
    left join secciones s on s.id = m.seccion_id
    left join cuentas_servicio cs on cs.id = m.cuenta_servicio_id
    where p.nombre_referencial ilike '%santa rosa%' and ts.nombre ilike '%luz%'
    order by s.nombre, m.codigo_medidor
  loop
    raise notice 'sección=% medidor=% (id %) -> cuenta=% (%) activo=% compartido=% general=%',
      coalesce(r.seccion, '(general)'), r.codigo_medidor, r.medidor_id, coalesce(r.cuenta_codigo, '(sin cuenta)'),
      r.cuenta_servicio_id, r.activo, r.es_compartido, r.es_general;
  end loop;

  raise notice '--- Cuentas de servicio de LUZ registradas para esa propiedad ---';
  for r in
    select cs.codigo, cs.nombre, cs.id, cs.activo
    from cuentas_servicio cs
    join propiedades p on p.id = cs.propiedad_id
    join tipos_servicio ts on ts.id = cs.tipo_servicio_id
    where p.nombre_referencial ilike '%santa rosa%' and ts.nombre ilike '%luz%'
  loop
    raise notice 'cuenta % (%) -> id % activo=%', r.codigo, r.nombre, r.id, r.activo;
  end loop;

  raise notice '--- Recibos generales de LUZ registrados para el periodo 2026-08 en esa propiedad ---';
  for r in
    select rg.periodo, rg.monto_total_recibo, cs.codigo as cuenta_codigo, rg.cuenta_servicio_id
    from recibos_generales_servicio rg
    join propiedades p on p.id = rg.propiedad_id
    join tipos_servicio ts on ts.id = rg.tipo_servicio_id
    left join cuentas_servicio cs on cs.id = rg.cuenta_servicio_id
    where p.nombre_referencial ilike '%santa rosa%' and ts.nombre ilike '%luz%' and rg.periodo = '2026-08'
  loop
    raise notice 'recibo periodo=% monto=% -> cuenta=%', r.periodo, r.monto_total_recibo, coalesce(r.cuenta_codigo, '(sin cuenta / única)');
  end loop;
end $$;
