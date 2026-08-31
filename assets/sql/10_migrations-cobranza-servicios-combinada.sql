-- ============================================================================
-- migrations-cobranza-servicios-combinada.sql
-- Separa "calcular una cuenta" de "generar la cobranza del periodo".
--
-- Antes: cada vez que calculabas UNA cuenta (ej. Lt14), el sistema creaba
-- la cuota de cobranza al toque, por cada sección. Con propiedades de varias
-- cuentas (Lt14, Lt15, Baño compartido...) esto generaba una cuota separada
-- por cuenta para el mismo inquilino, en vez de una sola cuota combinada
-- (ej. Lavadero 3 = Lt14 + Lt15 + Baño, como en el cuadro de control real).
--
-- Ahora el flujo queda en 3 pasos, como se factura en la práctica:
--   1. Tomar lecturas (ya existía).
--   2. Calcular cada cuenta por separado (calcular_periodo_servicio) — esto
--      ahora SOLO calcula y guarda el detalle de consumo/monto por sección,
--      todavía NO genera cuotas de cobranza.
--   3. Cuando TODAS las cuentas del servicio+periodo ya fueron calculadas,
--      correr generar_cobranzas_servicio — junta el detalle de todas las
--      cuentas por sección y recién ahí crea UNA cuota por inquilino.
-- ============================================================================

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

  -- Solo guarda el detalle de consumo/monto por sección — la cuota de
  -- cobranza se genera después, combinada, con generar_cobranzas_servicio.
  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    select id into v_contrato_id from contratos_alquiler
    where seccion_id = (v_item->>'seccion_id')::uuid and estado in ('vigente', 'por_vencer')
    order by fecha_inicio desc limit 1;

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

-- Junta el detalle de TODAS las cuentas ya calculadas de un
-- propiedad+servicio+periodo, agrupado por sección, y genera UNA cuota por
-- sección con el monto combinado. Exige que ya se hayan calculado todas las
-- cuentas (todos los recibos) de ese periodo, para no cobrar de menos.
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
  v_seccion record;
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

  for v_seccion in
    -- (array_agg(d.id))[1] queda como "detalle de referencia": cuotas solo
    -- puede apuntar a UN calculo_servicios_detalle (columna legada de cuando
    -- cada cuota venía de una sola cuenta), pero como todos los detalles de
    -- este grupo son de la misma sección/periodo/servicio, cualquiera de
    -- ellos resuelve correctamente el inquilino y la referencia al mostrarlo
    -- en Cobranzas — el monto de la cuota sale de la suma, no de ese detalle.
    -- Nota: no se usa min(d.id) porque Postgres no tiene agregado MIN/MAX
    -- para el tipo uuid.
    select d.seccion_id, sum(d.monto_calculado) as monto_total, (array_agg(d.id))[1] as detalle_ref_id
    from calculo_servicios_detalle d
    join calculo_servicios_periodo p on p.id = d.calculo_periodo_id
    where p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and d.cuota_id is null
    group by d.seccion_id
  loop
    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_seccion.detalle_ref_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo, v_seccion.monto_total, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle d
    set cuota_id = v_cuota_id
    from calculo_servicios_periodo p
    where d.calculo_periodo_id = p.id
      and p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and d.seccion_id = v_seccion.seccion_id
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
