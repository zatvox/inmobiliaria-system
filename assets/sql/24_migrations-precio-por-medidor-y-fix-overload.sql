-- ============================================================================
-- 24_migrations-precio-por-medidor-y-fix-overload.sql
--
-- Encontré un bug latente al implementar el precio editable por medidor:
-- la migración 11 creó calcular_periodo_servicio(uuid,uuid,text,uuid,jsonb,
-- numeric) — 6 parámetros, con p_precio_unitario_override. La migración 21
-- (fix de contrato multi-sección) hizo "create or replace" de
-- calcular_periodo_servicio(uuid,uuid,text,uuid,jsonb) — SOLO 5 parámetros,
-- sin el override — que en Postgres NO reemplaza a la función de 6
-- parámetros: crea una SEGUNDA función distinta (mismo nombre, distinta
-- firma). El frontend (supabase-data.js) siempre llama al RPC pasando
-- p_precio_unitario_override, así que sigue usando la versión VIEJA de 6
-- parámetros — la que NO tiene el fix de contrato_alquiler_secciones. El
-- bug de Piso 4/Piso 5 de Polonia se "arregló" solo porque el script 22
-- corrigió los datos ya calculados a mano; cualquier cálculo NUEVO habría
-- vuelto a fallar igual. Este script:
--   1) Elimina explícitamente ambas versiones (5 y 6 parámetros) para que
--      no quede ninguna ambigüedad de ahora en adelante.
--   2) Crea UNA sola función de 6 parámetros con el fix de contrato
--      multi-sección (de 21) + el override de precio a nivel de recibo
--      (de 11).
--   3) Agrega soporte de precio POR ÍTEM: cada elemento de p_detalles puede
--      traer su propio "precio_unitario" (ej. un medidor con tarifa propia
--      distinta al resto de la cuenta); si no lo trae, usa el precio
--      general de la cuenta como antes. Se guarda en
--      calculo_servicios_detalle.precio_unitario_aplicado por fila.
-- ============================================================================

drop function if exists calcular_periodo_servicio(uuid, uuid, text, uuid, jsonb);
drop function if exists calcular_periodo_servicio(uuid, uuid, text, uuid, jsonb, numeric);

create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb,
  p_precio_unitario_override numeric(12,4) default null
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
  v_item_precio numeric(12,4);
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

  -- Precio general de la cuenta: si el usuario lo corrigió a mano antes de
  -- confirmar, se respeta ese valor (p_precio_unitario_override).
  v_precio_unitario := coalesce(p_precio_unitario_override, v_recibo.precio_unitario,
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
    -- Precio de ESTA fila: si el ítem trae su propio precio_unitario (el
    -- usuario lo fijó distinto al general en la columna "Precio" de la
    -- vista previa), se usa ese; si no, cae al precio general de la cuenta.
    v_item_precio := coalesce((v_item->>'precio_unitario')::numeric, v_precio_unitario);

    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_item_precio, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    -- Busca el contrato de alquiler vigente que cubre esta sección a través
    -- de contratos_alquiler_secciones (incluye tanto la sección "original"
    -- como cualquier sección agregada como adenda).
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
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_item_precio,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id);
  end loop;

  return v_periodo_id;
end;
$$;

notify pgrst, 'reload schema';
