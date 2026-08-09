# SPECS — Sistema de Gestión Inmobiliaria (Ventas, Alquileres, Cobranzas y Pagos)

> Este documento complementa `PROMPT_MAESTRO_SISTEMA_WEB_FULLSTACK.md`. Reemplaza específicamente la sección de "módulos genéricos" con la especificación exacta de este sistema. Todo lo demás del prompt maestro (checklist de entrega, estándares de diseño, seguridad, accesibilidad, documentación) aplica sin cambios.

**Proyecto:** Sistema propio de gestión inmobiliaria (uso interno, una sola empresa — no multi-tenant)
**Stack:** Vanilla HTML/CSS/JS + Supabase (PostgreSQL + Auth + Storage + RLS) + GitHub Pages (web) · React Native + Expo consumiendo el mismo Supabase (mobile)
**Usuario:** Luis (`zatvox`) — desarrollador y operador del sistema

---

## 🎯 OBJETIVO DEL SISTEMA

Reemplazar hojas de cálculo y control manual por un sistema único que administre el ciclo de vida completo de una cartera de inmuebles: desde el alta de la propiedad, pasando por su comercialización (venta o alquiler), hasta la cobranza recurrente y el registro de pagos — con visibilidad total en web y en el celular.

---

## 📚 REFERENCIAS DE MERCADO

Estudiar patrones de estas plataformas reconocidas antes de diseñar cada módulo (no copiar UI, sí sus modelos de datos y flujos probados):

- **Buildium / AppFolio / DoorLoop** (EE.UU.) — referencia para el módulo de alquileres: ligan propiedad → unidad → contrato de arrendamiento → inquilino → cuenta de propietario a un mismo libro contable, para que el cobro de renta y los gastos queden siempre trazables a esa cadena de entidades. Aportan también el patrón de portal del inquilino, cargos automáticos por mora, y reportes de estado de cuenta por propietario.
- **Yardi Breeze / Rentec Direct** — referencia para conciliación bancaria y estados de cuenta multi-propiedad.
- **Tokko Broker** (líder de CRM inmobiliario en Latinoamérica, con presencia en Perú) — referencia para el módulo de ventas: pipeline de oportunidades por etapa, ficha de propiedad con multimedia, asignación de leads a agentes, y reportes de eficacia comercial por vendedor.

De estas plataformas se toman **tres decisiones de diseño** que gobiernan todo el esquema de datos:

1. Toda propiedad puede tener **una sola operación activa a la vez** (en venta *o* en alquiler), pero conserva su historial completo de ambas.
2. Cada **contrato** (de venta o de alquiler) es la entidad que ancla los cobros — nunca se cobra "a la propiedad", siempre se cobra "al contrato".
3. Cada **pago registrado** se enlaza a una **cuota/cobranza** específica, nunca queda suelto — así el estado de cuenta siempre cuadra.

---

## 🧩 MÓDULOS DEL SISTEMA

### 1. Inmuebles
- Alta de propiedad: tipo (departamento, casa, local, terreno, oficina, almacén), dirección, distrito/zona, área construida y de terreno, N° de habitaciones/baños/cocheras, año de construcción, partida registral.
- Galería de fotos y documentos (título de propiedad, HR/PU, planos) vía Supabase Storage.
- Estado de la propiedad: `disponible`, `en_venta`, `en_alquiler`, `vendido`, `alquilado`, `reservado`, `inactivo`.
- Precio de venta y/o precio de alquiler referencial, con historial de cambios de precio.
- Propietario asociado (puede ser el propio Luis/sus empresas, o un tercero si en el futuro se administra para otros).
- Ficha pública interna imprimible (para compartir con interesados).

### 2. Ventas
- Pipeline de oportunidades por etapa (`prospecto → visita agendada → negociación → separación → firma de contrato → cerrado/perdido`), inspirado en el módulo de oportunidades de Tokko Broker.
- Registro de interesados/leads con datos de contacto, fuente (referido, redes, portal, walk-in) y notas de seguimiento.
- Contrato de compraventa: comprador, precio pactado, forma de pago (contado / cuotas / crédito hipotecario), fecha de firma, documentos adjuntos.
- Si la venta es en cuotas (armado de pago directo con el vendedor, sin banco): genera automáticamente el cronograma de cuotas en el módulo de Cobranzas.
- Reporte de embudo de ventas y motivo de pérdida cuando una oportunidad se cierra como perdida.

### 3. Alquileres
- Contrato de arrendamiento: inquilino, propiedad, monto de renta mensual, moneda, día de vencimiento de pago, fecha de inicio/fin, depósito de garantía, cláusulas de renovación automática.
- Generación automática de cuotas de renta mensual mientras el contrato esté `vigente` (igual que la generación de recordatorios cronológicos de tu task manager: se generan instancias por adelantado, ej. próximos 90 días).
- Gestión de inquilinos: ficha con datos de contacto, DNI/RUC, referencias, documentos (contrato firmado, boletas de garantía).
- Estados del contrato: `vigente`, `por_vencer` (alerta a 30 días), `vencido`, `renovado`, `finalizado`.
- Registro de incidencias/mantenimiento reportadas por el inquilino, con estado (`reportado`, `en_proceso`, `resuelto`) — inspirado en el módulo de mantenimiento de Buildium/DoorLoop.

### 4. Cobranzas
- Vista unificada de todas las cuotas pendientes, sea de un contrato de venta en cuotas o de un contrato de alquiler mensual — misma tabla de origen, distinta referencia.
- Cálculo automático de mora: si una cuota pasa su fecha de vencimiento sin pago, se marca `vencida` y aplica un cargo por mora configurable (monto fijo o % — igual que "cargos automáticos por mora" de AppFolio/DoorLoop).
- Calendario de cobranzas (vista mensual tipo Google Calendar, mismo patrón que tu ZV Task Manager) mostrando qué cuotas vencen cada día.
- Notificaciones/recordatorios de cobranza próxima a vencer y de cobranza vencida.
- Estado de cuenta por contrato: total pactado, pagado, pendiente, próxima cuota.

### 5. Pagos
- Registro de pago contra una cuota específica de Cobranzas (nunca un pago "suelto"): monto, fecha, medio de pago (efectivo, transferencia, Yape/Plin, depósito, cheque), número de operación, comprobante adjunto (foto/PDF vía Storage).
- Soporte de pago parcial de una cuota (queda con saldo pendiente, no se marca pagada hasta completar el monto).
- Conciliación simple: marcar pagos como `verificado` una vez confirmados en cuenta bancaria.
- Historial de pagos por contrato, por propiedad y por cliente/inquilino.

### 6. Clientes (Compradores / Inquilinos / Propietarios)
- Ficha única de persona/empresa reutilizable entre los tres roles (un mismo contacto puede ser comprador en un contrato e inquilino en otro).
- Historial completo de operaciones de esa persona con la empresa.

### 7. Documentos
- Repositorio central de documentos por propiedad y por contrato (contratos firmados, boletas, comprobantes, fotos, planos) usando Supabase Storage con políticas de acceso.

### 8. Reportes
- Cartera de propiedades por estado (disponibles, vendidas, alquiladas).
- Ingresos por cobranza (mes a mes, proyectado vs. cobrado real).
- Morosidad: cuotas vencidas por antigüedad (0-30, 30-60, 60+ días).
- Embudo de ventas y desempeño si en el futuro hay más de un vendedor.
- Todos los reportes exportables a Excel/CSV (reutilizar patrones ya usados en JHIRO ERP).

### 9. Notificaciones
- Alertas dentro del sistema (web y push en mobile vía Expo) para: cuota por vencer, cuota vencida, contrato por vencer, nueva incidencia de mantenimiento reportada.

### 10. Configuración

Módulo central de personalización: **todo lo que hoy pensaríamos como "hay que editarlo en la base de datos" tiene que poder configurarse desde una pantalla**, con formularios, editores visuales y vista previa — sin tocar SQL ni código. Se organiza en pestañas:

**10.1 Empresa**
- Razón social, RUC, dirección fiscal, teléfono, email, logo (upload a Storage).
- Selector de empresa activa si en algún momento se opera con más de una razón social (Jhiro Peru S.A.C. / Benji Billion E.I.R.L. / una entidad nueva para este rubro) — cada documento generado usa los datos de la empresa seleccionada en ese contrato.
- Firma/representante legal para los contratos (nombre, DNI, cargo).

**10.2 Plantillas de Contrato (editor visual, no código)**
- Editor de texto enriquecido (tipo Word simplificado: negrita, subrayado, numeración, saltos de página) donde Luis redacta el cuerpo del contrato con **placeholders** insertables desde un selector, ej. `{{propiedad.direccion}}`, `{{inquilino.nombre}}`, `{{contrato.monto_renta}}`, `{{propietario.dni}}`, `{{contrato.fecha_inicio}}`.
- Una plantilla independiente por tipo de documento: **Contrato de Alquiler**, **Contrato de Compraventa**, y espacio para agregar plantillas adicionales a futuro (ej. adenda, carta de garantía) sin necesitar código nuevo.
- Vista previa en vivo: al editar la plantilla, se puede generar un PDF de prueba con datos de ejemplo (o de un contrato real ya cargado) para ver el resultado exacto antes de guardar.
- Versionado de plantillas: si se edita una plantilla, la versión anterior queda guardada en el historial y los contratos ya generados conservan una referencia a la versión con la que se generaron (para no alterar retroactivamente documentos ya firmados).
- Encabezado y pie de página configurables (logo, datos de la empresa, numeración de página, texto legal fijo).

**10.3 Numeración de documentos**
- Formato de numeración correlativa para contratos (ej. `CV-2026-0001` para venta, `CA-2026-0001` para alquiler), configurable por prefijo y contador — mismo patrón que la numeración de comprobantes en JHIRO ERP.

**10.4 Cobranzas y mora**
- Parámetros de mora: monto fijo o porcentaje, días de gracia antes de aplicar mora — editable desde formulario con vista previa del cálculo.
- Día(s) de generación anticipada de cuotas (cuántos meses/días por adelantado se generan).

**10.5 Catálogos**
- Tipos de propiedad, distritos/zonas, medios de pago, fuentes de lead, etapas del pipeline de ventas — cada catálogo con su propia pantalla de alta/edición/orden, sin límite fijo de opciones "quemadas" en el código.

**10.6 Notificaciones**
- Qué eventos disparan notificación y con cuántos días de anticipación (cuota por vencer, contrato por vencer), editable desde esta pantalla.

### 11. Generación de Contratos (PDF)
- Cuando la ficha del **inmueble**, del **inquilino/comprador**, del **propietario** y del **contrato** están completas, el sistema habilita el botón "Generar contrato".
- El sistema toma la plantilla configurada en **Configuración → Plantillas de Contrato** (según sea venta o alquiler), reemplaza cada placeholder con el dato real de esas cuatro entidades, y genera un **PDF descargable** con el logo y datos de la empresa activa.
- Validación previa: si falta un dato requerido por algún placeholder de la plantilla (ej. el inquilino no tiene DNI cargado), el sistema avisa exactamente qué campo falta antes de intentar generar el PDF, en vez de generar un documento con huecos.
- El PDF generado queda guardado automáticamente en **Documentos**, ligado al contrato correspondiente, con la fecha y la versión de plantilla usada.
- Se puede volver a generar el PDF (ej. tras corregir un dato) — cada regeneración queda en el historial de documentos del contrato, sin sobrescribir la anterior.
- Enfoque técnico sugerido (consistente con el stack vanilla JS): renderizar la plantilla ya con los placeholders reemplazados como HTML/CSS y convertirla a PDF en el navegador (ej. `html2pdf.js` o `pdf-lib`), subiendo el resultado a Supabase Storage — sin necesidad de un servicio backend adicional.

### 12. Usuarios y Roles
- Roles: `administrador` (Luis), `operador` (por si en el futuro suma a alguien para cobranzas o visitas).
- Cada rol con permisos distintos por módulo (RBAC simple, mismo enfoque que Buildium/DoorLoop mencionan como buena práctica).
- El acceso a **Configuración → Plantillas de Contrato** y **Empresa** queda restringido solo a `administrador`.

---

## 🗄️ MODELO DE DATOS (Supabase / PostgreSQL, con RLS)

```
PROPIEDADES ──┬── PROPIEDADES_FOTOS
              ├── PROPIEDADES_DOCUMENTOS
              ├── HISTORIAL_PRECIOS
              │
              ├── CONTRATOS_VENTA ──── COMPRADOR (→ PERSONAS)
              │        │
              ├── CONTRATOS_ALQUILER ── INQUILINO (→ PERSONAS)
              │        │
              │        └── INCIDENCIAS_MANTENIMIENTO
              │
              └── PROPIETARIO (→ PERSONAS)

CONTRATOS_VENTA ──┐
CONTRATOS_ALQUILER ┼──── CUOTAS (cobranzas) ──── PAGOS ──── PAGOS_COMPROBANTES
                   │
                   └── (origen: 'venta' | 'alquiler', referencia contrato_id)

PERSONAS ── roles múltiples: comprador / inquilino / propietario / lead

USUARIOS (auth.users) ── ROLES_USUARIOS
```

**Tablas principales sugeridas** (nombres en español, snake_case, consistente con JHIRO ERP):

- `propiedades` (tipo, direccion, distrito, area_m2, habitaciones, banos, cocheras, estado, precio_venta, precio_alquiler, propietario_id, created_at)
- `propiedades_fotos` / `propiedades_documentos` (propiedad_id, url_storage, tipo, descripcion)
- `historial_precios` (propiedad_id, tipo_operacion, precio, fecha_cambio)
- `personas` (nombre, dni_ruc, telefono, email, direccion, tipo_documento)
- `personas_roles` (persona_id, rol: comprador/inquilino/propietario/lead)
- `oportunidades_venta` (propiedad_id, persona_id, etapa, fuente, notas, fecha_creacion, motivo_perdida)
- `contratos_venta` (propiedad_id, comprador_id, precio_pactado, forma_pago, fecha_firma, estado, n_cuotas)
- `contratos_alquiler` (propiedad_id, inquilino_id, monto_renta, moneda, dia_vencimiento, fecha_inicio, fecha_fin, deposito_garantia, estado, renovacion_automatica)
- `cuotas` (contrato_tipo: 'venta'/'alquiler', contrato_id, numero_cuota, monto, fecha_vencimiento, estado: pendiente/pagada/parcial/vencida, mora_aplicada)
- `pagos` (cuota_id, monto, fecha_pago, medio_pago, n_operacion, estado: registrado/verificado, comprobante_url)
- `incidencias_mantenimiento` (contrato_alquiler_id, descripcion, estado, fecha_reporte, fecha_resolucion)
- `notificaciones` (usuario_id, tipo, referencia_id, mensaje, leido, fecha)
- `usuarios_roles` (usuario_id → auth.users, rol)
- `configuracion` (clave, valor) — para mora, días de gracia, numeración, generación anticipada de cuotas
- `catalogos` (tipo: tipo_propiedad/distrito/medio_pago/fuente_lead/etapa_venta, valor, orden, activo) — reemplaza catálogos "quemados" en código
- `empresas` (razon_social, ruc, direccion, telefono, email, logo_url, representante_nombre, representante_dni, representante_cargo)
- `plantillas_contrato` (tipo: venta/alquiler/otro, nombre, contenido_html, encabezado, pie_pagina, empresa_id, activa)
- `plantillas_contrato_versiones` (plantilla_id, contenido_html, fecha_version) — historial, referenciado desde cada contrato generado
- `documentos_generados` (contrato_tipo, contrato_id, plantilla_version_id, pdf_url, fecha_generacion) — cada PDF de contrato generado, sin sobrescribir versiones anteriores

**RLS:** activa en todas las tablas, con políticas basadas en `usuarios_roles` (mismo patrón que JHIRO ERP: `administrador` acceso total, `operador` acceso de lectura/escritura limitado a cobranzas y pagos, sin borrar contratos ni propiedades).

**Generación automática de cuotas:** al crear/activar un `contrato_alquiler` o un `contrato_venta` con cuotas, un trigger o función RPC en Supabase genera las filas en `cuotas` para todo el plazo pactado (igual patrón que la generación de instancias de recordatorios cronológicos del ZV Task Manager).

---

## 🔄 FLUJOS PRINCIPALES

1. **Alta de propiedad → publicación:** se registra la propiedad con fotos/documentos, se define si sale en venta o alquiler, queda `disponible`.
2. **Captación de interés (ventas):** se crea una oportunidad ligada a esa propiedad y a una persona; avanza por etapas hasta `separación` o `cerrado`.
3. **Firma de contrato (venta o alquiler):** se crea el contrato, la propiedad cambia de estado, y el sistema genera automáticamente el cronograma de cuotas en Cobranzas.
4. **Ciclo de cobranza:** cada cuota nace `pendiente`; si se acerca su vencimiento dispara notificación; si se pasa sin pago pasa a `vencida` y aplica mora según configuración.
5. **Registro de pago:** se registra un pago contra una cuota puntual (total o parcial); la cuota actualiza su estado; el estado de cuenta del contrato se recalcula.
6. **Cierre/renovación de alquiler:** al acercarse `fecha_fin`, el sistema alerta; si hay renovación automática, genera nuevo contrato o extiende el existente y continúa generando cuotas.
7. **Mantenimiento:** el inquilino (o Luis en su nombre) reporta una incidencia ligada al contrato de alquiler; se le da seguimiento hasta `resuelto`.
8. **Generación de contrato en PDF:** una vez completos los datos del inmueble, el inquilino/comprador, el propietario y el contrato, se elige la plantilla correspondiente (configurada previamente en Configuración), el sistema valida que no falte ningún dato requerido, arma el PDF con los placeholders reemplazados y lo guarda en Documentos ligado a ese contrato.

---

## 📱 APP MOBILE (React Native + Expo)

- Consume el mismo proyecto Supabase que la web (misma base de datos, mismas políticas RLS) — sin backend adicional.
- Pantallas prioritarias para uso desde el celular en campo: **Cobranzas del día/semana**, **Registrar pago** (con cámara para foto del comprobante, subida directa a Storage), **Ficha de propiedad** (para mostrarla a un interesado en una visita), **Nueva oportunidad/lead**, **Notificaciones**.
- Autenticación con Supabase Auth (mismo login que la web).
- Modo offline básico para registrar un pago sin señal y sincronizar al recuperar conexión (cola local simple).
- Notificaciones push vía Expo Notifications para cuotas por vencer/vencidas.

---

## 🎨 DISEÑO VISUAL

- Paleta sugerida: azul profundo (`#1B3A5C`) como color primario (confianza/solidez, típico del rubro inmobiliario), blanco/gris neutro, verde (`#2E7D4F`) para estados positivos (pagado, disponible) y rojo/ámbar para alertas (vencido, por vencer).
- Tipografía clara y legible en tablas densas (listados de cuotas, pagos).
- Dashboard principal con KPIs: propiedades disponibles, cuotas por cobrar este mes, morosidad total, próximos vencimientos de contrato.

---

## ✅ CRITERIOS DE ACEPTACIÓN ESPECÍFICOS (además del checklist genérico del prompt maestro)

- [ ] Ninguna cuota puede existir sin un `contrato_id` válido (venta o alquiler); ningún pago puede existir sin una `cuota_id` válida.
- [ ] Al crear un contrato de alquiler o venta en cuotas, el cronograma completo de cuotas se genera automáticamente sin intervención manual.
- [ ] Una cuota vencida sin pago aplica la mora configurada automáticamente, y esto queda visible en el estado de cuenta del contrato.
- [ ] El estado de una propiedad se actualiza automáticamente al firmarse un contrato de venta o alquiler (no requiere cambio manual aparte).
- [ ] La app mobile y la web muestran exactamente el mismo estado de cobranzas en tiempo real (misma fuente de datos, sin duplicación).
- [ ] Un pago parcial dejó correctamente el saldo pendiente visible y no marcó la cuota como pagada.
- [ ] RLS impide que el rol `operador` elimine contratos o propiedades.
- [ ] Ningún parámetro de negocio (mora, numeración, catálogos, textos de contrato) requiere editar una tabla directamente desde Supabase Studio — todo tiene una pantalla propia en Configuración.
- [ ] El botón "Generar contrato" queda deshabilitado (con mensaje del campo faltante) si algún placeholder de la plantilla no tiene dato cargado en inmueble/persona/contrato.
- [ ] Editar una plantilla de contrato no altera el PDF de un contrato ya generado con una versión anterior — el PDF generado siempre referencia la versión de plantilla usada en ese momento.
- [ ] El PDF generado descarga correctamente con el logo, datos de la empresa activa y todos los placeholders reemplazados por datos reales (ninguno queda como `{{...}}` literal).

---

**Instrucción para Claude Cowork:** usar este documento junto con `PROMPT_MAESTRO_SISTEMA_WEB_FULLSTACK.md` — este archivo reemplaza la sección "🧩 MÓDULOS DEL SISTEMA" y "📊 MÓDULOS PREDEFINIDOS POR TIPO DE SISTEMA" del prompt maestro; todo lo demás (diseño, seguridad, checklist, estructura de entrega) del prompt maestro aplica sin cambios. Entregar primero el sistema web (vanilla JS + Supabase + GitHub Pages) completo y funcional; la app React Native/Expo se desarrolla como segunda fase consumiendo el mismo proyecto Supabase ya en producción.
