-- ============================================================================
-- 21a_revertir-mora-erronea-URGENTE.sql
-- Corre esto PRIMERO, antes que 21_fix-mora-contrato-multiseccion-cobranzas.sql
-- Revierte la mora del 5% que "Actualizar vencidas" aplicó de más a TODAS
-- las cuotas vencidas (alquiler, venta y servicios) porque el botón leía el
-- % de la tabla vieja `configuracion` (sembrada en 5%) y no el de la
-- pantalla de Configuración.
--
-- Qué hace: pone mora_aplicada = 0 en toda cuota que tenga mora aplicada, y
-- vuelve a calcular su estado (pendiente/vencida/parcial/pagada) usando los
-- pagos reales que tenga registrados — no asume "pendiente" a ciegas, así
-- que es seguro aunque alguna ya tenga un pago parcial encima.
-- Es de un solo uso: después de correrlo, no hace falta repetirlo.
-- ============================================================================

do $$
declare
  r record;
  v_total int := 0;
begin
  for r in select id from cuotas where mora_aplicada > 0 loop
    update cuotas set mora_aplicada = 0 where id = r.id;
    perform recalcular_estado_cuota(r.id);
    v_total := v_total + 1;
  end loop;
  raise notice '% cuota(s) revertidas (mora quitada y estado recalculado).', v_total;
end $$;
