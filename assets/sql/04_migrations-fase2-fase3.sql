-- ============================================================================
-- SISTEMA DE GESTION INMOBILIARIA — MIGRACION FASE 2 + FASE 3
-- Ejecutar UNA VEZ, DESPUES de schema.sql + rls-policies.sql + seed.sql
-- (y despues de dev-open-access.sql si lo estas usando).
-- No modifica datos existentes; solo agrega funciones, triggers y una
-- columna nueva.
-- ============================================================================

-- ============================================================================
-- 1. Columna de conveniencia: que contrato de alquiler estaba vigente en la
--    seccion al momento de calcular un periodo de servicio (evita tener que
--    reconstruir esa relacion por fecha cada vez que se muestra Cobranzas).
-- ============================================================================
alter table calculo_servicios_detalle
  add column if not exists contrato_alquiler_id uuid references contratos_alquiler(id);

-- ============================================================================
-- 2. FASE 2 — Generacion automatica de cuotas de VENTA en cuotas
--    (equivalente a generar_cuotas_alquiler, para contratos_venta con
--    forma_pago = 'cuotas'). Reparte precio_pactado en n_cuotas cuotas
--    mensuales iguales, ajustando la ultima por redondeo.
-- ============================================================================
create or replace function generar_cuotas_venta(p_contrato_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_monto_cuota numeric(12,2);
  v_suma numeric(12,2) := 0;
  v_fecha date;
  v_i int;
begin
  select * into c from contratos_venta where id = p_contrato_id;
  if not found then
    raise exception 'Contrato de venta % no existe', p_contrato_id;
  end if;
  if c.forma_pago <> 'cuotas' or c.n_cuotas is null or c.n_cuotas < 1 then
    return; -- nada que generar (contado / credito_hipotecario / sin n_cuotas)
  end if;
  if exists (select 1 from cuotas where origen = 'venta' and contrato_id = p_contrato_id) then
    return; -- ya se generaron antes (evita duplicar en updates repetidos)
  end if;

  v_monto_cuota := round(c.precio_pactado / c.n_cuotas, 2);

  for v_i in 1..c.n_cuotas loop
    v_fecha := (date_trunc('month', c.fecha_firma) + (v_i || ' months')::interval)::date
               + (extract(day from c.fecha_firma)::int - 1) * interval '1 day';
    -- si el dia no existe en ese mes (ej. 31), date_trunc+interval ya lo corrige al mes correcto
    if v_i = c.n_cuotas then
      -- ultima cuota: ajusta por el redondeo acumulado para que la suma cuadre exacto
      insert into cuotas (origen, contrato_id, numero_cuota, concepto, monto, fecha_vencimiento, estado)
      values ('venta', p_contrato_id, v_i, 'Cuota de venta ' || v_i || '/' || c.n_cuotas,
              c.precio_pactado - v_suma, v_fecha, 'pendiente');
    else
      insert into cuotas (origen, contrato_id, numero_cuota, concepto, monto, fecha_vencimiento, estado)
      values ('venta', p_contrato_id, v_i, 'Cuota de venta ' || v_i || '/' || c.n_cuotas,
              v_monto_cuota, v_fecha, 'pendiente');
      v_suma := v_suma + v_monto_cuota;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- 3. Trigger de contratos_venta ampliado: ahora reacciona tambien a UPDATE de
--    estado (antes solo INSERT), para que cambiar el estado desde la UI
--    (ej. marcar "completado") actualice la seccion correctamente. Tambien
--    dispara la generacion de cuotas cuando forma_pago = 'cuotas'.
-- ============================================================================
create or replace function trg_fn_contrato_venta_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'completado' then
    update secciones set estado = 'vendido' where id = new.seccion_id;
  elsif new.estado = 'vigente' then
    update secciones set estado = 'reservado' where id = new.seccion_id;
    perform generar_cuotas_venta(new.id);
  elsif new.estado = 'anulado' then
    update secciones set estado = 'disponible' where id = new.seccion_id and estado in ('reservado');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_venta_creado on contratos_venta;
create trigger trg_contrato_venta_creado
  after insert or update of estado on contratos_venta
  for each row execute function trg_fn_contrato_venta_creado();

-- ============================================================================
-- 4. Trigger de contratos_alquiler ampliado: reacciona tambien a UPDATE de
--    estado, para que "finalizado" libere la seccion (vuelve a 'disponible').
-- ============================================================================
create or replace function trg_fn_contrato_alquiler_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('vigente', 'por_vencer') then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
    perform generar_cuotas_alquiler(new.id);
  elsif new.estado = 'finalizado' then
    update secciones set estado = 'disponible' where id = new.seccion_id and estado = 'alquilado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_alquiler_creado on contratos_alquiler;
create trigger trg_contrato_alquiler_creado
  after insert or update of estado on contratos_alquiler
  for each row execute function trg_fn_contrato_alquiler_creado();

-- ============================================================================
-- 5. FASE 3 — Recalculo automatico del estado de una cuota cuando se
--    registra, edita, anula o elimina un pago. Suma los pagos no anulados de
--    la cuota y decide pendiente / parcial / pagada. No toca 'vencida' salvo
--    que el pago la cubra por completo (pasa a 'pagada').
-- ============================================================================
create or replace function recalcular_estado_cuota(p_cuota_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_pagado numeric(12,2);
  v_total_debido numeric(12,2);
  v_estado_actual text;
  v_estado_nuevo text;
begin
  select coalesce(sum(monto), 0) into v_total_pagado
  from pagos where cuota_id = p_cuota_id and estado <> 'anulado';

  select (monto + mora_aplicada), estado into v_total_debido, v_estado_actual
  from cuotas where id = p_cuota_id;

  if v_estado_actual is null then
    return; -- la cuota ya no existe
  end if;
  if v_estado_actual = 'anulada' then
    return; -- estado manual, no se toca por pagos
  end if;

  if v_total_pagado <= 0 then
    v_estado_nuevo := case when v_estado_actual = 'vencida' then 'vencida' else 'pendiente' end;
  elsif v_total_pagado < v_total_debido then
    v_estado_nuevo := 'parcial';
  else
    v_estado_nuevo := 'pagada';
  end if;

  if v_estado_nuevo <> v_estado_actual then
    update cuotas set estado = v_estado_nuevo where id = p_cuota_id;
  end if;
end;
$$;

create or replace function trg_fn_pagos_recalcula_cuota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform recalcular_estado_cuota(old.cuota_id);
    return old;
  else
    perform recalcular_estado_cuota(new.cuota_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_pagos_recalcula_cuota on pagos;
create trigger trg_pagos_recalcula_cuota
  after insert or update or delete on pagos
  for each row execute function trg_fn_pagos_recalcula_cuota();

-- ============================================================================
-- 6. FASE 3 — Aplicar mora a cuotas vencidas (segun configuracion.clave =
--    'mora': {tipo:'porcentaje'|'fijo', valor, dias_gracia}). Pensada para
--    llamarse manualmente desde un boton "Actualizar vencidas" en Cobranzas
--    (RPC), y opcionalmente via pg_cron diario si el usuario lo habilita
--    (Database -> Extensions -> pg_cron en el panel de Supabase; ver nota al
--    final de este archivo). Es idempotente: no vuelve a aplicar mora a una
--    cuota que ya la tiene.
-- ============================================================================
create or replace function aplicar_mora_cuotas_vencidas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_tipo text;
  v_valor numeric;
  v_dias_gracia int;
  v_actualizadas int;
begin
  select valor into v_config from configuracion where clave = 'mora';
  v_tipo := coalesce(v_config->>'tipo', 'porcentaje');
  v_valor := coalesce((v_config->>'valor')::numeric, 0);
  v_dias_gracia := coalesce((v_config->>'dias_gracia')::int, 0);

  with vencidas as (
    update cuotas
    set estado = 'vencida',
        mora_aplicada = case
          when v_tipo = 'porcentaje' then round(monto * v_valor / 100, 2)
          else v_valor
        end
    where estado = 'pendiente'
      and fecha_vencimiento < (current_date - v_dias_gracia)
      and mora_aplicada = 0
    returning id
  )
  select count(*) into v_actualizadas from vencidas;

  return v_actualizadas;
end;
$$;

-- ============================================================================
-- 7. FASE 3 — RPC principal del modulo "Calculo de Servicios": toma un
--    periodo (propiedad + tipo de servicio + 'YYYY-MM'), el recibo general
--    ya registrado, y el detalle por seccion (medidor o tarifa fija por
--    persona) calculado en el frontend con los datos ya cargados en pantalla,
--    y hace TODO el trabajo de negocio en el servidor en una sola
--    transaccion: crea el periodo, el detalle por seccion y la cuota de
--    cobranza (origen='servicio') correspondiente a cada seccion.
--
--    p_detalles: jsonb array de objetos:
--      { "seccion_id": uuid, "metodo": "medidor"|"tarifa_fija_por_persona",
--        "lectura_id": uuid|null, "consumo": numeric|null,
--        "n_personas": int|null, "tarifa_por_persona": numeric|null }
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
  v_tipo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_periodo_date date;
  v_dias_en_mes int;
  v_dia int;
  v_fecha_venc date;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
  v_detalle_id uuid;
  v_cuota_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo
    where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo
  ) then
    raise exception 'Ya existe un calculo confirmado para esta propiedad, servicio y periodo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;
  select * into v_tipo from tipos_servicio where id = p_tipo_servicio_id;

  v_precio_unitario := coalesce(v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  v_periodo_date := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_dias_en_mes := extract(day from (date_trunc('month', v_periodo_date) + interval '1 month - 1 day'))::int;
  v_dia := least(coalesce(v_tipo.dia_corte_mensual, 15), v_dias_en_mes);
  v_fecha_venc := date_trunc('month', v_periodo_date)::date + (v_dia - 1);

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

    select id into v_contrato_id from contratos_alquiler
    where seccion_id = (v_item->>'seccion_id')::uuid and estado in ('vigente', 'por_vencer')
    order by fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id)
    returning id into v_detalle_id;

    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_detalle_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo,
            v_monto, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle set cuota_id = v_cuota_id where id = v_detalle_id;
  end loop;

  return v_periodo_id;
end;
$$;

-- ============================================================================
-- NOTA sobre automatizacion diaria de mora (opcional):
-- Supabase permite habilitar la extension "pg_cron" (Database -> Extensions)
-- y luego programar, por ejemplo:
--   select cron.schedule('aplicar-mora-diario', '0 6 * * *', $$select aplicar_mora_cuotas_vencidas();$$);
-- Mientras no se habilite, el boton "Actualizar vencidas" de Cobranzas llama
-- a la misma funcion manualmente via RPC — funciona igual, solo que no es
-- automatico dia a dia.
-- ============================================================================

-- ============================================================================
-- FIN migrations-fase2-fase3.sql
-- ============================================================================
