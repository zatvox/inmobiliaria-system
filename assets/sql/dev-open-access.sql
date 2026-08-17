-- ============================================================================
-- MODO DESARROLLO — Acceso abierto temporal (SOLO mientras AUTH_ENABLED en
-- assets/js/config.js esté en `false`, es decir, mientras no se gestionan
-- logins).
--
-- ⚠️  ADVERTENCIA DE SEGURIDAD ⚠️
-- Este script agrega políticas que permiten al rol "anon" (cualquier
-- visitante sin iniciar sesión, usando solo la anon key pública) leer y
-- escribir TODAS las tablas y el bucket de Storage. Es equivalente a
-- desactivar la seguridad del sistema. Úsalo solo:
--   - en desarrollo local, o
--   - en un repositorio/GitHub Pages que NO compartas públicamente todavía.
-- Antes de compartir la URL con nadie más o de operar con datos reales de
-- cobranzas, vuelve a poner AUTH_ENABLED = true en config.js y corre la
-- sección "REVERTIR" al final de este archivo.
--
-- Ejecutar DESPU�S de schema.sql + rls-policies.sql (+ seed.sql opcional).
-- ============================================================================

do $$
declare
  t text;
  tablas text[] := array[
    'empresas','usuarios_roles','personas','personas_roles','catalogos','tipos_servicio',
    'propiedades','propiedades_fotos','propiedades_documentos','secciones','secciones_fotos',
    'historial_precios','comisiones_agentes','contratos_alquiler','contratos_venta',
    'oportunidades','cuotas','pagos','medidores','lecturas_medidores',
    'recibos_generales_servicio','calculo_servicios_periodo','calculo_servicios_detalle',
    'incidencias_mantenimiento','notificaciones','configuracion',
    'mantenimientos','mantenimientos_comprobantes','tributos_municipales'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists dev_anon_all on %I;', t);
    execute format('create policy dev_anon_all on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;

-- Storage: acceso abierto al bucket "inmuebles" para el rol anon.
drop policy if exists dev_anon_storage_select on storage.objects;
create policy dev_anon_storage_select on storage.objects
  for select to anon using (bucket_id = 'inmuebles');
drop policy if exists dev_anon_storage_insert on storage.objects;
create policy dev_anon_storage_insert on storage.objects
  for insert to anon with check (bucket_id = 'inmuebles');
drop policy if exists dev_anon_storage_update on storage.objects;
create policy dev_anon_storage_update on storage.objects
  for update to anon using (bucket_id = 'inmuebles');
drop policy if exists dev_anon_storage_delete on storage.objects;
create policy dev_anon_storage_delete on storage.objects
  for delete to anon using (bucket_id = 'inmuebles');

-- ============================================================================
-- REVERTIR (cuando actives AUTH_ENABLED = true en config.js otra vez):
-- copia y ejecuta el bloque de abajo en el SQL Editor de Supabase.
-- ============================================================================
--
-- do $$
-- declare
--   t text;
--   tablas text[] := array[
--     'empresas','usuarios_roles','personas','personas_roles','catalogos','tipos_servicio',
--     'propiedades','propiedades_fotos','propiedades_documentos','secciones','secciones_fotos',
--     'historial_precios','comisiones_agentes','contratos_alquiler','contratos_venta',
--     'oportunidades_venta','cuotas','pagos','medidores','lecturas_medidores',
--     'recibos_generales_servicio','calculo_servicios_periodo','calculo_servicios_detalle',
--     'incidencias_mantenimiento','notificaciones','configuracion'
--   ];
-- begin
--   foreach t in array tablas loop
--     execute format('drop policy if exists dev_anon_all on %I;', t);
--   end loop;
-- end $$;
--
-- drop policy if exists dev_anon_storage_select on storage.objects;
-- drop policy if exists dev_anon_storage_insert on storage.objects;
-- drop policy if exists dev_anon_storage_update on storage.objects;
-- drop policy if exists dev_anon_storage_delete on storage.objects;
--
-- ============================================================================
-- FIN dev-open-access.sql
-- ============================================================================
