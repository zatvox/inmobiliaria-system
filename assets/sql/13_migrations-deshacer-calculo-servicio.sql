-- ============================================================================
-- migrations-deshacer-calculo-servicio.sql
-- Permite corregir un cálculo de servicios ya confirmado, o una cobranza ya
-- generada, sin editar filas a mano en la base de datos. Nunca se edita un
-- cálculo confirmado in-place — siempre se deshace y se rehace, para no
-- perder trazabilidad:
--
--   1. eliminar_cuota_servicio(cuota_id) — borra una cuota de origen
--      'servicio' ya generada y libera (cuota_id = null) el detalle de
--      cálculo que la alimentaba, para que vuelva a quedar "pendiente de
--      facturar". Bloqueada si la cuota ya tiene pagos registrados (hay que
--      anularlos primero desde Cobranzas, con lo que ya existe hoy).
--
--   2. deshacer_calculo_servicio(recibo_general_id) — borra el cálculo
--      confirmado de UNA cuenta (calculo_servicios_periodo + su detalle,
--      por cascada) para poder corregir una lectura y recalcular. Bloqueada
--      si ese detalle ya quedó ligado a una cuota (hay que eliminarla
--      primero con la función de arriba).
--
-- Flujo para corregir una lectura de un medidor cuya cuenta ya se calculó:
--   a) Si la cuenta AÚN no generó cobranza: "Deshacer cálculo" esa cuenta
--      en el tab Cálculo → corregir la lectura en "Lecturas del mes" →
--      volver a "Calcular esta cuenta".
--   b) Si la cobranza YA se generó: primero "Eliminar" la cuota en
--      Cobranzas y Pagos (si tiene pagos, anúlalos antes) → eso libera el
--      detalle → "Deshacer cálculo" de la cuenta afectada → corregir la
--      lectura → recalcular esa cuenta → "Generar cobranzas del periodo"
--      de nuevo (solo genera lo que falte, no duplica lo ya facturado).
-- ============================================================================

create or replace function eliminar_cuota_servicio(p_cuota_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota record;
  v_pagos int;
begin
  if auth_rol() <> 'administrador' then
    raise exception 'Solo un administrador puede eliminar una cuota generada.';
  end if;

  select * into v_cuota from cuotas where id = p_cuota_id;
  if not found then
    raise exception 'La cuota % no existe.', p_cuota_id;
  end if;
  if v_cuota.origen <> 'servicio' then
    raise exception 'Esta función solo elimina cuotas de servicio (agua/luz/otros).';
  end if;

  select count(*) into v_pagos from pagos where cuota_id = p_cuota_id;
  if v_pagos > 0 then
    raise exception 'Esta cuota ya tiene % pago(s) registrado(s) — anúlalos primero desde el detalle de la cuota antes de eliminarla.', v_pagos;
  end if;

  update calculo_servicios_detalle set cuota_id = null where cuota_id = p_cuota_id;
  delete from cuotas where id = p_cuota_id;
end;
$$;

create or replace function deshacer_calculo_servicio(p_recibo_general_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_periodo_id uuid;
  v_facturados int;
begin
  if auth_rol() <> 'administrador' then
    raise exception 'Solo un administrador puede deshacer un cálculo confirmado.';
  end if;

  select id into v_periodo_id from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id;
  if not found then
    raise exception 'Esta cuenta todavía no tiene un cálculo confirmado.';
  end if;

  select count(*) into v_facturados
  from calculo_servicios_detalle
  where calculo_periodo_id = v_periodo_id and cuota_id is not null;

  if v_facturados > 0 then
    raise exception 'Esta cuenta ya está incluida en % cuota(s) de cobranza generada(s) — elimina esa(s) cuota(s) primero desde Cobranzas y Pagos.', v_facturados;
  end if;

  delete from calculo_servicios_periodo where id = v_periodo_id; -- cascada borra su calculo_servicios_detalle
end;
$$;

notify pgrst, 'reload schema';
