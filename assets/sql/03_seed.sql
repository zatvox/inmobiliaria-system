-- ============================================================================
-- SISTEMA DE GESTION INMOBILIARIA — SEED (Fase 1)
-- Ejecutar DESPUES de schema.sql y rls-policies.sql.
-- Corre como el rol de servicio (service_role) o directamente en el SQL
-- Editor de Supabase, que no aplica RLS.
--
-- IMPORTANTE: varios datos vienen de memoria de Luis y estan marcados como
-- "por confirmar" en el campo notas / comentarios. Revisar y corregir desde
-- el modulo Inmuebles apenas estas disponible. No se fabrico ningun RUC/DNI.
-- Ver docs/ADDENDUM-SECCIONES-SERVICIOS.md seccion 4 para el detalle.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CATALOGOS
-- ----------------------------------------------------------------------------
insert into catalogos (tipo, valor, orden) values
  ('tipo_propiedad','Edificio',1),
  ('tipo_propiedad','Departamento',2),
  ('tipo_propiedad','Casa',3),
  ('tipo_propiedad','Local comercial',4),
  ('tipo_propiedad','Terreno / Lotes',5),
  ('tipo_propiedad','Oficina',6),
  ('tipo_propiedad','Almacen',7),
  ('distrito','San Juan de Lurigancho',1),
  ('distrito','Ate',2),
  ('medio_pago','Efectivo',1),
  ('medio_pago','Transferencia bancaria',2),
  ('medio_pago','Yape',3),
  ('medio_pago','Plin',4),
  ('medio_pago','Deposito en cajero',5),
  ('medio_pago','Cheque',6),
  ('fuente_lead','Referido',1),
  ('fuente_lead','Redes sociales',2),
  ('fuente_lead','Portal inmobiliario',3),
  ('fuente_lead','Walk-in',4);

-- ----------------------------------------------------------------------------
-- TIPOS DE SERVICIO (modulo Calculo de Servicios)
-- Tarifa por persona (S/20) es el ejemplo que dio Luis — editable en
-- Configuracion. Gas/Internet/Telefonia/Cable nacen como gasto fijo (no
-- prorrateable); se puede activar el prorrateo por consumo si aplica.
-- ----------------------------------------------------------------------------
insert into tipos_servicio (id, nombre, unidad_medida, prorrateable_por_consumo, permite_tarifa_fija_por_persona, tarifa_por_persona_default, dia_corte_mensual, orden) values
  ('daa32b69-4e13-456f-b3d3-938f50413c14','Luz','kWh', true, true, 20.00, 19, 1),
  ('2efe6f25-73ab-42cd-b9cc-76fb26bcf077','Agua','m3', true, true, 20.00, 10, 2),
  ('c4f4b5aa-7327-45f2-b0cd-0fb83e169bdd','Gas','kg', false, true, 20.00, null, 3),
  ('c8c7f539-ea31-4f81-ad4f-cdb551f78aea','Internet / Wifi','N/A', false, false, null, null, 4),
  ('e7bb4f9a-1c70-4857-ae19-dddd8d29aa0b','Telefonia / Celular','N/A', false, false, null, null, 5),
  ('e428f486-6126-4f93-b054-e76599135ccc','Cable / TV','N/A', false, false, null, null, 6);

-- ----------------------------------------------------------------------------
-- PERSONAS
-- Solo se cargo el nombre de pila que dio Luis. Apellidos, DNI y telefono
-- quedan pendientes de completar (ver notas).
-- ----------------------------------------------------------------------------
insert into personas (id, nombre, notas) values
  ('eeedd4fe-096f-48d6-b47d-de4722af0699','Luis Paz Vilca', 'Propietario. Confirmar si las 3 propiedades son a titulo personal o de una empresa (Jhiro Peru S.A.C. / Benji Billion E.I.R.L. / entidad nueva) — ver Configuracion > Empresa.'),
  ('ecf1214e-e218-437d-9ab5-a2d7291ddb0d','Alizon', 'Inquilina Piso 1-2 (duplex), Republica de Polonia 721. Falta apellido, DNI y telefono. Contrato pendiente de renovar.'),
  ('a58e9eab-34a1-493e-a9e1-c1c9cc907490','Antonio', 'Inquilino Depto Piso 3-A, Republica de Polonia 721. Falta apellido, DNI y telefono.'),
  ('5b9cc33b-b480-4bee-a13f-ae1deaa84074','Ruben', 'Inquilino Depto Piso 3-B, Republica de Polonia 721. Falta apellido, DNI y telefono. Monto de renta dado con duda ("creo") — confirmar.'),
  ('bd10022c-46ab-4dd9-b1e4-1e61d49f891f','Alex', 'Inquilino Piso 4-5 y (aparentemente) Piso 6, Republica de Polonia 721. Falta apellido, DNI y telefono. Confirmar si es la misma persona en ambos pisos.');

insert into personas_roles (persona_id, rol) values
  ('eeedd4fe-096f-48d6-b47d-de4722af0699','propietario'),
  ('ecf1214e-e218-437d-9ab5-a2d7291ddb0d','inquilino'),
  ('a58e9eab-34a1-493e-a9e1-c1c9cc907490','inquilino'),
  ('5b9cc33b-b480-4bee-a13f-ae1deaa84074','inquilino'),
  ('bd10022c-46ab-4dd9-b1e4-1e61d49f891f','inquilino');

-- ----------------------------------------------------------------------------
-- PROPIEDADES (predios/edificios fisicos)
-- ----------------------------------------------------------------------------
insert into propiedades (id, nombre_referencial, tipo, direccion, distrito, n_pisos, propietario_id, notas) values
  ('7d115a9d-18d8-4340-9d7d-33b19366576e','Edificio Republica de Polonia 721','Edificio','Av. Republica de Polonia 721','San Juan de Lurigancho', 6, 'eeedd4fe-096f-48d6-b47d-de4722af0699', 'Edificio de 6 pisos con 5 secciones alquiladas.'),
  ('3d0086c0-e761-4a09-9bd6-467781dd7346','Lotes Santa Rosa de Lima Mz. S','Terreno / Lotes','Av. Santa Rosa de Lima Mz. S','San Juan de Lurigancho', null, 'eeedd4fe-096f-48d6-b47d-de4722af0699', 'Lotes 15, 14 y 07. Inquilinos y montos de renta pendientes de registrar (negocios comerciales).'),
  ('79a86b22-7983-47e1-9983-b09de9f7be9c','Edificio Amsterdam 280','Edificio','Calle Amsterdam 280','Ate', null, 'eeedd4fe-096f-48d6-b47d-de4722af0699', 'Duplex en 1er/2do piso + 3 departamentos. Pisos exactos, areas e inquilinos (si los hay) pendientes de confirmar.');

-- ----------------------------------------------------------------------------
-- SECCIONES — Edificio Republica de Polonia 721
-- ----------------------------------------------------------------------------
insert into secciones (id, propiedad_id, nombre, tipo_seccion, area_m2, estado, precio_alquiler_referencial, notas) values
  ('9cfcc67c-3113-402a-ab5f-00d32ef262a3','7d115a9d-18d8-4340-9d7d-33b19366576e','Piso 1-2 (Duplex)','duplex', null, 'alquilado', 5000.00, 'Contrato pendiente de renovar.'),
  ('c9c90de6-5331-451b-bba3-54af32484885','7d115a9d-18d8-4340-9d7d-33b19366576e','Depto Piso 3 - A','departamento', 120.00, 'alquilado', 1400.00, null),
  ('565b38db-f001-463d-bf2e-74e3b8072223','7d115a9d-18d8-4340-9d7d-33b19366576e','Depto Piso 3 - B','departamento', 120.00, 'alquilado', 1300.00, 'Monto dado con duda ("creo") — confirmar con Luis.'),
  ('ddd221a0-866a-4ca7-9c88-8f03a3627099','7d115a9d-18d8-4340-9d7d-33b19366576e','Piso 4-5','piso', null, 'alquilado', 3600.00, null),
  ('3b54cc9c-7aa1-4be4-89fe-8798645b3aac','7d115a9d-18d8-4340-9d7d-33b19366576e','Piso 6','piso', null, 'alquilado', 1250.00, 'Monto y ocupante dados con duda ("parece que") — confirmar si es el mismo Alex del piso 4-5 y el monto exacto. Contrato reciente.');

-- ----------------------------------------------------------------------------
-- SECCIONES — Lotes Santa Rosa de Lima
-- ----------------------------------------------------------------------------
insert into secciones (id, propiedad_id, nombre, tipo_seccion, estado, notas) values
  ('4f180a2a-7794-4605-8b6f-a63492fcb20b','3d0086c0-e761-4a09-9bd6-467781dd7346','Lote 15','lote', 'alquilado', 'Negocio comercial. Inquilino y renta pendientes de registrar.'),
  ('e530cf24-85a0-4dcd-a2c8-1c38f8f4d3c5','3d0086c0-e761-4a09-9bd6-467781dd7346','Lote 14','lote', 'alquilado', 'Negocio comercial. Inquilino y renta pendientes de registrar.'),
  ('dc345c87-176f-4658-95e9-def32933563b','3d0086c0-e761-4a09-9bd6-467781dd7346','Lote 07','lote', 'alquilado', 'Negocio comercial. Inquilino y renta pendientes de registrar.');

-- ----------------------------------------------------------------------------
-- SECCIONES — Edificio Amsterdam 280, Ate
-- ----------------------------------------------------------------------------
insert into secciones (id, propiedad_id, nombre, tipo_seccion, estado, notas) values
  ('532bd35b-f470-4b46-aead-19aad018e88b','79a86b22-7983-47e1-9983-b09de9f7be9c','Duplex (Piso 1-2)','duplex', 'disponible', 'Area, precio e inquilino (si aplica) pendientes de confirmar.'),
  ('356a5ca0-1880-4502-a5dd-45ea0bac3de3','79a86b22-7983-47e1-9983-b09de9f7be9c','Departamento 1','departamento', 'disponible', 'Piso, area, precio e inquilino (si aplica) pendientes de confirmar.'),
  ('5da9a8f4-76e5-478d-a0ff-61d3f00fec52','79a86b22-7983-47e1-9983-b09de9f7be9c','Departamento 2','departamento', 'disponible', 'Piso, area, precio e inquilino (si aplica) pendientes de confirmar.'),
  ('fe3f5b28-447d-4f87-b7af-bed2a3e1df29','79a86b22-7983-47e1-9983-b09de9f7be9c','Departamento 3','departamento', 'disponible', 'Piso, area, precio e inquilino (si aplica) pendientes de confirmar.');

-- ----------------------------------------------------------------------------
-- CONTRATOS DE ALQUILER
-- fecha_inicio y dia_vencimiento son ESTIMADOS (no fueron proporcionados) —
-- actualizar con la fecha real en cuanto este disponible el modulo Contratos
-- (Fase 2). Al insertar con estado 'vigente' se dispara automaticamente la
-- generacion del cronograma de cuotas (trigger trg_contrato_alquiler_creado).
-- ----------------------------------------------------------------------------
insert into contratos_alquiler (id, seccion_id, inquilino_id, monto_renta, moneda, dia_vencimiento, fecha_inicio, estado, notas) values
  ('70c316e9-149d-4e41-ae6d-841da6ed453e','9cfcc67c-3113-402a-ab5f-00d32ef262a3','ecf1214e-e218-437d-9ab5-a2d7291ddb0d', 5000.00, 'PEN', 5, date_trunc('month', current_date - interval '18 months')::date, 'por_vencer', 'Fecha de inicio y dia de pago ESTIMADOS. Contrato pendiente de renovar — confirmar fecha real de vencimiento.'),
  ('eab26055-6456-4567-9b15-f7a216c684c0','c9c90de6-5331-451b-bba3-54af32484885','a58e9eab-34a1-493e-a9e1-c1c9cc907490', 1400.00, 'PEN', 5, date_trunc('month', current_date - interval '10 months')::date, 'vigente', 'Fecha de inicio y dia de pago ESTIMADOS — confirmar.'),
  ('7000890f-d664-4d60-ba9d-73ac15ff72a8','565b38db-f001-463d-bf2e-74e3b8072223','5b9cc33b-b480-4bee-a13f-ae1deaa84074', 1300.00, 'PEN', 5, date_trunc('month', current_date - interval '10 months')::date, 'vigente', 'Monto, fecha de inicio y dia de pago ESTIMADOS — confirmar con Luis.'),
  ('4c68a36f-6b5d-4ee4-ae91-483929111d29','ddd221a0-866a-4ca7-9c88-8f03a3627099','bd10022c-46ab-4dd9-b1e4-1e61d49f891f', 3600.00, 'PEN', 5, date_trunc('month', current_date - interval '8 months')::date, 'vigente', 'Fecha de inicio y dia de pago ESTIMADOS — confirmar.'),
  ('04da1359-9534-46f0-9a48-8530f7b800f1','3b54cc9c-7aa1-4be4-89fe-8798645b3aac','bd10022c-46ab-4dd9-b1e4-1e61d49f891f', 1250.00, 'PEN', 5, date_trunc('month', current_date - interval '1 month')::date, 'vigente', 'Contrato reciente. Monto, fecha de inicio y si es el mismo inquilino Alex del piso 4-5 — confirmar con Luis.');

-- ----------------------------------------------------------------------------
-- CONFIGURACION — parametros de negocio (valores por defecto, editables
-- desde el panel de Configuracion en fases siguientes)
-- ----------------------------------------------------------------------------
insert into configuracion (clave, valor, descripcion) values
  ('mora', '{"tipo":"porcentaje","valor":5,"dias_gracia":5}'::jsonb, 'Mora aplicada a cuotas vencidas: 5% tras 5 dias de gracia (ejemplo, ajustar segun politica real).'),
  ('generacion_anticipada_cuotas', '{"meses":12}'::jsonb, 'Cuantos meses de cuotas se generan por adelantado al crear un contrato de alquiler.'),
  ('numeracion_contratos', '{"venta":{"prefijo":"CV","anio":2026,"siguiente":1},"alquiler":{"prefijo":"CA","anio":2026,"siguiente":1}}'::jsonb, 'Formato de numeracion correlativa de contratos generados en PDF.');

-- ============================================================================
-- NOTA: no se cargaron medidores, lecturas ni recibos generales de
-- luz/agua — esos datos se registran desde el modulo "Calculo de Servicios"
-- (Fase 3) con datos reales (codigo de medidor, foto, lectura del mes).
--
-- NOTA: no se cargaron comisiones de agentes inmobiliarios — falta el
-- nombre del/los agente(s) y el % o monto pactado por cada contrato.
--
-- NOTA: no se creo ninguna fila en empresas ni en usuarios_roles. Para
-- usuarios_roles, primero hay que crear tu usuario de autenticacion desde
-- Supabase Auth (o el login de la app) y luego ejecutar:
--   insert into usuarios_roles (usuario_id, rol, nombre_visible)
--   values ('<uuid-de-tu-usuario-auth>', 'administrador', 'Luis');
-- ============================================================================
