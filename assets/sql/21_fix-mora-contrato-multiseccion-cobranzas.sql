-- ============================================================================
-- 21_fix-mora-contrato-multiseccion-cobranzas.sql
-- Tres bugs encontrados al probar cobranzas de servicios con contratos
-- multi-sección (ej. Edificio Polonia):
--
-- 1) aplicar_mora_cuotas_vencidas() seguía leyendo el % de mora de la tabla
--    vieja `configuracion` (columna clave='mora', sembrada una vez en
--    03_seed.sql con 5%), NO de `configuracion_sistema.porcentaje_mora_mensual`
--    que es la que de verdad edita la pantalla de Configuración. Por eso
--    poner 0% en Configuración no tenía ningún efecto: seguía aplicando el
--    5% viejo hardcodeado en el seed.
--
-- 2) calcular_periodo_servicio() solo buscaba el contrato de una sección
--    mirando contratos_alquiler.seccion_id (la sección "original"). Una
--    sección agregada después como adenda (contratos_alquiler_secciones)
--    nunca encontraba su contrato -> contrato_alquiler_id quedaba NULL ->
--    esa sección salía sin nombre de inquilino y como una cuota aparte.
--
-- 3) generar_cobranzas_servicio() agrupaba las cuotas por seccion_id. Un
--    inquilino con 2+ secciones bajo el mismo contrato (ej. Piso 4 + Piso 5)
--    terminaba con una cuota de cobranza POR SECCIÓN en vez de una sola
--    cuota combinada por contrato/inquilino.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fix 1: mora usa configuracion_sistema, no la tabla vieja `configuracion`.
-- ---------------------------------------------------------------------------
create or replace function aplicar_mora_cuotas_vencidas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_porcentaje numeric;
  v_dias_gracia int;
  v_actualizadas int;
begin
  select porcentaje_mora_mensual, dias_gracia_mora
    into v_porcentaje, v_dias_gracia
  from configuracion_sistema where id = true;

  v_porcentaje := coalesce(v_porcentaje, 0);
  v_dias_gracia := coalesce(v_dias_gracia, 0);

  with vencidas as (
    update cuotas
    set estado = 'vencida',
        mora_aplicada = round(monto * v_porcentaje / 100, 2)
    where estado = 'pendiente'
      and fecha_vencimiento < (current_date - v_dias_gracia)
      and mora_aplicada = 0
    returning id
  )
  select count(*) into v_actualizadas from vencidas;

  return v_actualizadas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 2: calcular_periodo_servicio() resuelve el contrato de una sección vía
-- contratos_alquiler_secciones (cubre secciones originales Y de adenda), no
-- solo contratos_alquiler.seccion_id.
-- ---------------------------------------------------------------------------
create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id
  ) then
    raise exception 'Ya existe un calculo confirmado para este recibo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;

  v_precio_unitario := coalesce(v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    -- Busca el contrato de alquiler vigente que cubre esta sección a través
    -- de contratos_alquiler_secciones (incluye tanto la sección "original"
    -- como cualquier sección agregada como adenda) — antes solo miraba
    -- contratos_alquiler.seccion_id, que ignoraba las adendas.
    select ca.id into v_contrato_id
    from contratos_alquiler_secciones cas
    join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
    where cas.seccion_id = (v_item->>'seccion_id')::uuid and ca.estado in ('vigente', 'por_vencer')
    order by ca.fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id);
  end loop;

  return v_periodo_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 3: generar_cobranzas_servicio() agrupa por contrato_alquiler_id cuando
-- existe (una sola cuota por inquilino aunque tenga varias secciones bajo el
-- mismo contrato), y solo cae a seccion_id cuando no hay contrato asociado
-- (ej. sección vacía o sin contrato de alquiler registrado).
-- ---------------------------------------------------------------------------
create or replace function generar_cobranzas_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo record;
  v_periodo_date date;
  v_dias_en_mes int;
  v_dia int;
  v_fecha_venc date;
  v_total_recibos int;
  v_total_calculados int;
  v_grupo record;
  v_cuota_id uuid;
  v_generadas int := 0;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para generar cobranzas';
  end if;

  select count(*) into v_total_recibos
  from recibos_generales_servicio
  where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo;

  if v_total_recibos = 0 then
    raise exception 'No hay ningún recibo general registrado para esta propiedad, servicio y periodo.';
  end if;

  select count(*) into v_total_calculados
  from calculo_servicios_periodo
  where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo;

  if v_total_calculados < v_total_recibos then
    raise exception 'Faltan % cuenta(s) por calcular antes de generar la cobranza de este periodo.', (v_total_recibos - v_total_calculados);
  end if;

  select * into v_tipo from tipos_servicio where id = p_tipo_servicio_id;
  v_periodo_date := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_dias_en_mes := extract(day from (date_trunc('month', v_periodo_date) + interval '1 month - 1 day'))::int;
  v_dia := least(coalesce(v_tipo.dia_corte_mensual, 15), v_dias_en_mes);
  v_fecha_venc := date_trunc('month', v_periodo_date)::date + (v_dia - 1);

  for v_grupo in
    -- Se agrupa por contrato_alquiler_id cuando existe (mismo inquilino,
    -- aunque tenga varias secciones bajo el mismo contrato) y por
    -- seccion_id cuando no (sección sin contrato de alquiler asociado).
    -- (array_agg(d.id))[1] queda como "detalle de referencia": cuotas solo
    -- puede apuntar a UN calculo_servicios_detalle (columna legada de cuando
    -- cada cuota venía de una sola cuenta), pero cualquiera de los detalles
    -- del grupo resuelve correctamente el inquilino al mostrarlo en
    -- Cobranzas — el monto de la cuota sale de la suma, no de ese detalle.
    select
      d.contrato_alquiler_id,
      coalesce(d.contrato_alquiler_id::text, d.seccion_id::text) as clave_grupo,
      sum(d.monto_calculado) as monto_total,
      (array_agg(d.id))[1] as detalle_ref_id
    from calculo_servicios_detalle d
    join calculo_servicios_periodo p on p.id = d.calculo_periodo_id
    where p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and d.cuota_id is null
    group by coalesce(d.contrato_alquiler_id::text, d.seccion_id::text), d.contrato_alquiler_id
  loop
    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_grupo.detalle_ref_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo, v_grupo.monto_total, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle d
    set cuota_id = v_cuota_id
    from calculo_servicios_periodo p
    where d.calculo_periodo_id = p.id
      and p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and coalesce(d.contrato_alquiler_id::text, d.seccion_id::text) = v_grupo.clave_grupo
      and d.cuota_id is null;

    v_generadas := v_generadas + 1;
  end loop;

  if v_generadas = 0 then
    raise exception 'No hay consumos pendientes de facturar para esta propiedad, servicio y periodo (¿ya se generaron las cobranzas antes?).';
  end if;

  return v_generadas;
end;
$$;

notify pgrst, 'reload schema';
