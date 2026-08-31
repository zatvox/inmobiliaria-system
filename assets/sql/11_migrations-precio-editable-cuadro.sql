-- ============================================================================
-- migrations-precio-editable-cuadro.sql
-- Permite editar el precio unitario (S/ por m3 de agua o kWh de luz) al
-- calcular una cuenta, en vez de forzar siempre el precio derivado del
-- recibo general. El precio del recibo general sigue siendo el valor por
-- defecto que se muestra al usuario, pero ahora puede corregirlo antes de
-- confirmar el cálculo (ej. cuando el recibo real trae un precio distinto
-- al recalculado, o hay que redondear distinto).
-- ============================================================================

-- Añadir un parámetro nuevo (aunque tenga default) NO reemplaza la función
-- de 5 parámetros existente — Postgres la trataría como un overload aparte
-- y luego una llamada con 5 argumentos quedaría ambigua entre ambas. Hay
-- que borrar explícitamente la firma vieja antes de crear la nueva.
drop function if exists calcular_periodo_servicio(uuid, uuid, text, uuid, jsonb);

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

  -- El precio del recibo general (o el recalculado monto/consumo) sigue
  -- siendo el valor por defecto, pero si el usuario lo edita en pantalla
  -- antes de confirmar, se respeta ese valor (p_precio_unitario_override).
  v_precio_unitario := coalesce(p_precio_unitario_override, v_recibo.precio_unitario,
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

notify pgrst, 'reload schema';
