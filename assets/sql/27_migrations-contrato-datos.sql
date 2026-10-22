-- 27: Datos extra del documento de contrato de alquiler
-- Ejecutar en Supabase > SQL Editor. Guarda en el propio contrato lo que el modelo
-- necesita y no existe como columna (representante legal, partida electrónica,
-- abonos de garantía, llaves, contacto, uso, anexos, etc.).
ALTER TABLE contratos_alquiler ADD COLUMN IF NOT EXISTS datos_contrato jsonb NOT NULL DEFAULT '{}'::jsonb;
NOTIFY pgrst, 'reload schema';
