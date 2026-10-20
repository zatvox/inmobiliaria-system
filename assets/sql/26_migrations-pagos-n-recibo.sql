-- 26: Separar N° de recibo y N° de operación en pagos
-- Ejecutar en Supabase > SQL Editor ANTES de usar los modales nuevos.
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS n_recibo text;
-- n_operacion = operación bancaria (+ comprobante_url = voucher)
-- n_recibo    = recibo (+ foto_cobranza_url = recibo firmado)
