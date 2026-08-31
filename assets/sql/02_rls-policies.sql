-- ============================================================================
-- SISTEMA DE GESTION INMOBILIARIA — ROW LEVEL SECURITY (Fase 1)
-- Ejecutar DESPUES de schema.sql y ANTES de seed.sql
-- Roles de la app: administrador (Luis, acceso total) / operador (lectura
-- general + lectura-escritura en Cobranzas, Pagos y modulo Calculo de
-- Servicios, sin poder borrar contratos ni propiedades — segun SPECS-SISTEMA
-- -INMUEBLES.md seccion 12 "Usuarios y Roles").
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas de negocio
-- ---------------------------------------------------------------------------
alter table empresas enable row level security;
alter table usuarios_roles enable row level security;
alter table personas enable row level security;
alter table personas_roles enable row level security;
alter table catalogos enable row level security;
alter table tipos_servicio enable row level security;
alter table propiedades enable row level security;
alter table propiedades_fotos enable row level security;
alter table propiedades_documentos enable row level security;
alter table secciones enable row level security;
alter table secciones_fotos enable row level security;
alter table historial_precios enable row level security;
alter table comisiones_agentes enable row level security;
alter table contratos_alquiler enable row level security;
alter table contratos_venta enable row level security;
alter table oportunidades_venta enable row level security;
alter table cuotas enable row level security;
alter table pagos enable row level security;
alter table medidores enable row level security;
alter table lecturas_medidores enable row level security;
alter table recibos_generales_servicio enable row level security;
alter table calculo_servicios_periodo enable row level security;
alter table calculo_servicios_detalle enable row level security;
alter table incidencias_mantenimiento enable row level security;
alter table notificaciones enable row level security;
alter table configuracion enable row level security;

-- ---------------------------------------------------------------------------
-- USUARIOS_ROLES
-- Cada usuario ve su propio rol; solo administrador ve/gestiona todos.
-- ---------------------------------------------------------------------------
create policy usuarios_roles_self_select on usuarios_roles
  for select using (usuario_id = auth.uid() or auth_rol() = 'administrador');
create policy usuarios_roles_admin_all on usuarios_roles
  for all using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- Tablas de SOLO LECTURA para operador / ALL para administrador
-- (empresas, personas, personas_roles, catalogos, tipos_servicio,
--  propiedades + anexos, secciones + anexos, historial_precios,
--  comisiones_agentes, contratos_alquiler, contratos_venta,
--  oportunidades_venta, configuracion)
-- ---------------------------------------------------------------------------

create policy empresas_read on empresas
  for select using (auth_rol() in ('administrador','operador'));
create policy empresas_admin_write on empresas
  for insert with check (auth_rol() = 'administrador');
create policy empresas_admin_update on empresas
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy empresas_admin_delete on empresas
  for delete using (auth_rol() = 'administrador');

create policy personas_read on personas
  for select using (auth_rol() in ('administrador','operador'));
create policy personas_admin_write on personas
  for insert with check (auth_rol() = 'administrador');
create policy personas_admin_update on personas
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy personas_admin_delete on personas
  for delete using (auth_rol() = 'administrador');

create policy personas_roles_read on personas_roles
  for select using (auth_rol() in ('administrador','operador'));
create policy personas_roles_admin_write on personas_roles
  for insert with check (auth_rol() = 'administrador');
create policy personas_roles_admin_delete on personas_roles
  for delete using (auth_rol() = 'administrador');

create policy catalogos_read on catalogos
  for select using (auth_rol() in ('administrador','operador'));
create policy catalogos_admin_write on catalogos
  for insert with check (auth_rol() = 'administrador');
create policy catalogos_admin_update on catalogos
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy catalogos_admin_delete on catalogos
  for delete using (auth_rol() = 'administrador');

create policy tipos_servicio_read on tipos_servicio
  for select using (auth_rol() in ('administrador','operador'));
create policy tipos_servicio_admin_write on tipos_servicio
  for insert with check (auth_rol() = 'administrador');
create policy tipos_servicio_admin_update on tipos_servicio
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy tipos_servicio_admin_delete on tipos_servicio
  for delete using (auth_rol() = 'administrador');

create policy propiedades_read on propiedades
  for select using (auth_rol() in ('administrador','operador'));
create policy propiedades_admin_write on propiedades
  for insert with check (auth_rol() = 'administrador');
create policy propiedades_admin_update on propiedades
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy propiedades_admin_delete on propiedades
  for delete using (auth_rol() = 'administrador');

create policy propiedades_fotos_read on propiedades_fotos
  for select using (auth_rol() in ('administrador','operador'));
create policy propiedades_fotos_admin_write on propiedades_fotos
  for insert with check (auth_rol() = 'administrador');
create policy propiedades_fotos_admin_delete on propiedades_fotos
  for delete using (auth_rol() = 'administrador');

create policy propiedades_documentos_read on propiedades_documentos
  for select using (auth_rol() in ('administrador','operador'));
create policy propiedades_documentos_admin_write on propiedades_documentos
  for insert with check (auth_rol() = 'administrador');
create policy propiedades_documentos_admin_delete on propiedades_documentos
  for delete using (auth_rol() = 'administrador');

create policy secciones_read on secciones
  for select using (auth_rol() in ('administrador','operador'));
create policy secciones_admin_write on secciones
  for insert with check (auth_rol() = 'administrador');
create policy secciones_admin_update on secciones
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy secciones_admin_delete on secciones
  for delete using (auth_rol() = 'administrador');

create policy secciones_fotos_read on secciones_fotos
  for select using (auth_rol() in ('administrador','operador'));
create policy secciones_fotos_admin_write on secciones_fotos
  for insert with check (auth_rol() = 'administrador');
create policy secciones_fotos_admin_delete on secciones_fotos
  for delete using (auth_rol() = 'administrador');

create policy historial_precios_read on historial_precios
  for select using (auth_rol() in ('administrador','operador'));
create policy historial_precios_admin_write on historial_precios
  for insert with check (auth_rol() = 'administrador');

create policy comisiones_agentes_read on comisiones_agentes
  for select using (auth_rol() in ('administrador','operador'));
create policy comisiones_agentes_admin_write on comisiones_agentes
  for insert with check (auth_rol() = 'administrador');
create policy comisiones_agentes_admin_update on comisiones_agentes
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy comisiones_agentes_admin_delete on comisiones_agentes
  for delete using (auth_rol() = 'administrador');

create policy contratos_alquiler_read on contratos_alquiler
  for select using (auth_rol() in ('administrador','operador'));
create policy contratos_alquiler_admin_write on contratos_alquiler
  for insert with check (auth_rol() = 'administrador');
create policy contratos_alquiler_admin_update on contratos_alquiler
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy contratos_alquiler_admin_delete on contratos_alquiler
  for delete using (auth_rol() = 'administrador');

create policy contratos_venta_read on contratos_venta
  for select using (auth_rol() in ('administrador','operador'));
create policy contratos_venta_admin_write on contratos_venta
  for insert with check (auth_rol() = 'administrador');
create policy contratos_venta_admin_update on contratos_venta
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy contratos_venta_admin_delete on contratos_venta
  for delete using (auth_rol() = 'administrador');

create policy oportunidades_venta_read on oportunidades_venta
  for select using (auth_rol() in ('administrador','operador'));
create policy oportunidades_venta_write on oportunidades_venta
  for insert with check (auth_rol() in ('administrador','operador'));
create policy oportunidades_venta_update on oportunidades_venta
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy oportunidades_venta_admin_delete on oportunidades_venta
  for delete using (auth_rol() = 'administrador');

create policy configuracion_read on configuracion
  for select using (auth_rol() in ('administrador','operador'));
create policy configuracion_admin_write on configuracion
  for insert with check (auth_rol() = 'administrador');
create policy configuracion_admin_update on configuracion
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy configuracion_admin_delete on configuracion
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- COBRANZAS Y PAGOS — operador tiene lectura/escritura (sin delete);
-- administrador acceso total. Incluye el tab "Servicios" (cuotas.origen =
-- 'servicio'), que usa esta misma tabla.
-- ---------------------------------------------------------------------------
create policy cuotas_read on cuotas
  for select using (auth_rol() in ('administrador','operador'));
create policy cuotas_write on cuotas
  for insert with check (auth_rol() in ('administrador','operador'));
create policy cuotas_update on cuotas
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy cuotas_admin_delete on cuotas
  for delete using (auth_rol() = 'administrador');

create policy pagos_read on pagos
  for select using (auth_rol() in ('administrador','operador'));
create policy pagos_write on pagos
  for insert with check (auth_rol() in ('administrador','operador'));
create policy pagos_update on pagos
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy pagos_admin_delete on pagos
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- MODULO CALCULO DE SERVICIOS — mismo criterio que Cobranzas/Pagos: el
-- operador toma lecturas, sube fotos y corre el calculo; solo admin borra.
-- ---------------------------------------------------------------------------
create policy medidores_read on medidores
  for select using (auth_rol() in ('administrador','operador'));
create policy medidores_write on medidores
  for insert with check (auth_rol() in ('administrador','operador'));
create policy medidores_update on medidores
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy medidores_admin_delete on medidores
  for delete using (auth_rol() = 'administrador');

create policy lecturas_medidores_read on lecturas_medidores
  for select using (auth_rol() in ('administrador','operador'));
create policy lecturas_medidores_write on lecturas_medidores
  for insert with check (auth_rol() in ('administrador','operador'));
create policy lecturas_medidores_update on lecturas_medidores
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy lecturas_medidores_admin_delete on lecturas_medidores
  for delete using (auth_rol() = 'administrador');

create policy recibos_generales_read on recibos_generales_servicio
  for select using (auth_rol() in ('administrador','operador'));
create policy recibos_generales_write on recibos_generales_servicio
  for insert with check (auth_rol() in ('administrador','operador'));
create policy recibos_generales_update on recibos_generales_servicio
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy recibos_generales_admin_delete on recibos_generales_servicio
  for delete using (auth_rol() = 'administrador');

create policy calculo_periodo_read on calculo_servicios_periodo
  for select using (auth_rol() in ('administrador','operador'));
create policy calculo_periodo_write on calculo_servicios_periodo
  for insert with check (auth_rol() in ('administrador','operador'));
create policy calculo_periodo_update on calculo_servicios_periodo
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy calculo_periodo_admin_delete on calculo_servicios_periodo
  for delete using (auth_rol() = 'administrador');

create policy calculo_detalle_read on calculo_servicios_detalle
  for select using (auth_rol() in ('administrador','operador'));
create policy calculo_detalle_write on calculo_servicios_detalle
  for insert with check (auth_rol() in ('administrador','operador'));
create policy calculo_detalle_update on calculo_servicios_detalle
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy calculo_detalle_admin_delete on calculo_servicios_detalle
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- MANTENIMIENTO — operador puede crear/actualizar incidencias, no borrar.
-- ---------------------------------------------------------------------------
create policy incidencias_read on incidencias_mantenimiento
  for select using (auth_rol() in ('administrador','operador'));
create policy incidencias_write on incidencias_mantenimiento
  for insert with check (auth_rol() in ('administrador','operador'));
create policy incidencias_update on incidencias_mantenimiento
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy incidencias_admin_delete on incidencias_mantenimiento
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- NOTIFICACIONES — cada usuario ve/marca-leido las suyas; administrador todo.
-- ---------------------------------------------------------------------------
create policy notificaciones_self_read on notificaciones
  for select using (usuario_id = auth.uid() or auth_rol() = 'administrador');
create policy notificaciones_self_update on notificaciones
  for update using (usuario_id = auth.uid() or auth_rol() = 'administrador')
  with check (usuario_id = auth.uid() or auth_rol() = 'administrador');
create policy notificaciones_system_insert on notificaciones
  for insert with check (auth_rol() in ('administrador','operador'));
create policy notificaciones_admin_delete on notificaciones
  for delete using (auth_rol() = 'administrador');

-- ============================================================================
-- STORAGE (Supabase Storage) — ejemplo de politicas para el bucket "inmuebles"
-- Crear el bucket manualmente en el dashboard (privado, no publico) y luego
-- aplicar estas politicas sobre storage.objects filtrando por bucket_id.
-- Estructura de carpetas sugerida dentro del bucket:
--   propiedades/{propiedad_id}/...
--   secciones/{seccion_id}/...
--   medidores/{medidor_id}/lecturas/...
--   pagos/{pago_id}/comprobantes/...
-- ============================================================================
create policy storage_inmuebles_read on storage.objects
  for select using (
    bucket_id = 'inmuebles' and auth_rol() in ('administrador','operador')
  );
create policy storage_inmuebles_insert on storage.objects
  for insert with check (
    bucket_id = 'inmuebles' and auth_rol() in ('administrador','operador')
  );
create policy storage_inmuebles_update on storage.objects
  for update using (
    bucket_id = 'inmuebles' and auth_rol() in ('administrador','operador')
  );
create policy storage_inmuebles_delete on storage.objects
  for delete using (
    bucket_id = 'inmuebles' and auth_rol() = 'administrador'
  );

-- ============================================================================
-- FIN rls-policies.sql
-- ============================================================================
