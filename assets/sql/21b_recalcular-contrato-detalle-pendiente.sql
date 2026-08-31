-- ============================================================================
-- 21b_recalcular-contrato-detalle-pendiente.sql
-- El fix de 21_fix-mora-contrato-multiseccion-cobranzas.sql solo corrige la
-- función calcular_periodo_servicio() de aquí en adelante — no toca datos
-- que ya se habían calculado ANTES con el bug viejo. Eliminar una cuota
-- (eliminar_cuota_servicio) tampoco recalcula el contrato de cada fila, solo
-- la desvincula de la cuota. Por eso Piso 4 / Piso 5 de Project Textil
-- seguían saliendo con el contrato_alquiler_id viejo (null en la sección de
-- adenda) al volver a generar la cobranza.
--
-- Este script recalcula contrato_alquiler_id en TODO el detalle que todavía
-- no está facturado (cuota_id is null) usando la misma lógica ya corregida
-- (busca por contratos_alquiler_secciones, no solo por
-- contratos_alquiler.seccion_id). Es seguro correrlo las veces que haga
-- falta — no toca nada que ya tenga una cuota generada.
--
-- PASOS para probar de nuevo con Project Textil / Polonia:
--   1. En Cobranzas y Pagos, elimina (🗑️) las 2 cuotas de S/50 que ya se
--      generaron para Piso 4 y Piso 5 (así vuelven a quedar sin cuota_id).
--   2. Corre este script.
--   3. En Cálculo de Servicios, corre "Generar cobranzas del periodo" de
--      nuevo para Polonia / Agua / 2026-08 — ahora debería salir 1 sola
--      cuota de S/100 para Project Textil, con las 2 secciones en un solo
--      cuadro de consumo.
-- ============================================================================

update calculo_servicios_detalle d
set contrato_alquiler_id = sub.contrato_id
from (
  select distinct on (cas.seccion_id) cas.seccion_id, ca.id as contrato_id
  from contratos_alquiler_secciones cas
  join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
  where ca.estado in ('vigente', 'por_vencer')
  order by cas.seccion_id, ca.fecha_inicio desc
) sub
where d.seccion_id = sub.seccion_id
  and d.cuota_id is null
  and d.contrato_alquiler_id is distinct from sub.contrato_id;

-- Si una sección quedó SIN ningún contrato vigente que la cubra (ej. local
-- vacío o contrato finalizado), su contrato_alquiler_id se deja en null a
-- propósito — eso hace que generar_cobranzas_servicio la agrupe por
-- seccion_id en vez de por contrato, que es lo correcto para ese caso.
