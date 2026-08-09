# 🏗️ PLANTILLA MAESTRA — ARQUITECTURA DOCUMENTAL PARA CUALQUIER SISTEMA

**Framework:** Problema → RFC → PRD → System Design → Tech Spec → ADRs → Desarrollo con IA → Runbook → Post-Mortem (+ System Prompt Spec si hay agentes LLM)
**Uso:** copiar este archivo al iniciar cualquier proyecto, renombrar a `ARQUITECTURA-[PROYECTO].md`, completar cada sección EN ORDEN. Ningún código se escribe hasta aprobar las secciones 1–5.

---

## 📑 SÍLABO DEL DOCUMENTO

| # | Sección | Submódulos principales | Capa |
|---|---|---|---|
| 0 | **Reglas del framework** | Orden obligatorio · barandas para IA · gestión del cambio documental | Meta |
| 1 | **RFC** — Request for Comments | Problema · propuesta · alternativas evaluadas · riesgos e impactos · alcance de la decisión | Decisión |
| 2 | **PRD** — Product Requirements | Usuarios y roles · historias de usuario · funcionalidades por prioridad · fuera de alcance · métricas de éxito · flujo principal · supuestos | Producto |
| 3 | **System Design Doc** | Diagrama de componentes · máquinas de estado · flujos críticos · escalabilidad · seguridad · dependencias y fallos | Ingeniería |
| 4 | **Tech Spec** | Stack · estructura de carpetas · modelo de datos (ER + tablas) · APIs/funciones · permisos/RLS · integraciones externas · preguntas abiertas | Ingeniería |
| 5 | **ADRs** — Decision Records | Índice de decisiones · formato contexto→decisión→descartadas→consecuencias | Decisión |
| 6 | **Runbook** | Mapa de producción · procedimiento de despliegue · incidentes mapeados · SLAs de operación · smoke tests · monitoreo de cuotas · backups · traspaso | Operación |
| 7 | **Post-Mortem (template)** | Resumen · impacto · línea de tiempo · causa raíz (5 porqués) · acciones correctivas · lecciones | Operación |
| 8 | **System Prompt Spec** | Rol por agente · input/output estructurado · barandas · reglas anti-traslape | IA |

---

## 0. REGLAS DEL FRAMEWORK

1. Las secciones se completan **en orden**; cada una alimenta a la siguiente.
2. **PRD = producto** (qué y por qué). **System Design + Tech Spec = ingeniería** (cómo). No mezclar.
3. Toda decisión técnica nueva durante el desarrollo → **ADR nuevo antes de implementar** (nunca decisión implícita en el código).
4. Cambio de alcance → actualizar PRD primero, código después.
5. Este documento es la **baranda** del desarrollador (humano o IA): si el código contradice el documento, gana el documento o se actualiza con ADR explícito.
6. Todo incidente en producción → Post-Mortem blameless en 48 h.
7. Preguntas abiertas se listan con su módulo bloqueado; bloquean su módulo, no el arranque del proyecto.

---

## 1. RFC — REQUEST FOR COMMENTS

> Define el problema ANTES de codear. En proyectos chicos puede ser breve; en corporativos es lo que sustenta el proyecto ante TI.

### 1.1 Problema
Describir la situación actual, a quién le duele, con qué frecuencia y qué cuesta (tiempo/dinero/riesgo). Sin mencionar soluciones todavía.

### 1.2 Propuesta
La solución elegida en 3-5 líneas: qué es, cómo monetiza/ahorra, cuál es su diferencial.

### 1.3 Alternativas evaluadas
| Alternativa | Por qué se descartó |
|---|---|
| A. ... | ... |
| B. (elegida) | — |

### 1.4 Riesgos e impactos
| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|

Cubrir mínimo: riesgo de mercado/adopción, riesgo técnico, riesgo financiero/fraude, riesgo legal, límites de proveedores.

### 1.5 Alcance de esta RFC
Qué aprueba este documento y qué queda explícitamente para RFCs futuras.

---

## 2. PRD — PRODUCT REQUIREMENTS DOCUMENT

> La sección más importante: QUÉ construir y POR QUÉ. Cero ingeniería aquí.

### 2.1 Problema y oportunidad
Resumen del RFC en lenguaje de producto.

### 2.2 Usuarios y roles
Diagrama Mermaid de actores + tabla de roles con permisos de alto nivel y superficie que usa cada uno (app/web/panel).

```mermaid
flowchart LR
    U1[Rol 1] --> S[Sistema]
    U2[Rol 2] --> S
```

### 2.3 Historias de usuario
| # | Como... | Quiero... | Para... | Prioridad (P0/P1/P2) |
|---|---|---|---|---|

P0 = sin esto no hay producto · P1 = versión 2 · P2 = futuro.

### 2.4 Funcionalidades por módulo y fase
Lista por prioridad: **P0 (v1)** / **P1 (v2)** / **P2 (v3)**, y sección explícita de **Fuera de alcance** (lo que NO se hará, para frenar el scope creep).

### 2.5 Métricas de éxito
| Métrica | Meta corto plazo | Meta 12 meses |
|---|---|---|

Incluir métricas de adopción, operación (tasas de finalización/error) y negocio (ingresos/ahorro).

### 2.6 Flujo principal del producto
Diagrama de secuencia Mermaid del happy path completo, de punta a punta.

### 2.7 Supuestos y dependencias
Lo que se asume verdadero (con enlace al ADR que lo respalda cuando aplique).

---

## 3. SYSTEM DESIGN DOC

> Cómo se ve el sistema completo. Aquí vive la ingeniería de alto nivel: componentes, comunicación, escalabilidad, seguridad.

### 3.1 Diagrama de componentes
Mermaid `flowchart` con: capa de presentación (cada frontend), backend/servicios, base de datos, APIs externas, y las flechas de comunicación entre ellos. Anotar el **principio rector de seguridad** (dónde está la frontera de confianza).

### 3.2 Máquinas de estado
Mermaid `stateDiagram-v2` para cada entidad con ciclo de vida (pedido, servicio, documento, pago): estados, transiciones, quién dispara cada una, estados terminales y de excepción (cancelado/disputa).

### 3.3 Flujos de datos críticos
Diagrama de secuencia por cada operación transaccional o sensible (dinero, asignación con concurrencia, aprobaciones). Anotar garantías: atomicidad, locks, idempotencia.

### 3.4 Escalabilidad
| Punto de presión | Diseño que lo resuelve |
|---|---|

Cubrir: tabla de mayor escritura (partición/retención/batching), consultas de listado (índices + paginación), difusión en tiempo real (canales por segmento, no globales), almacenamiento de archivos (compresión/límites), y umbrales de upgrade de plan.

### 3.5 Seguridad
Mínimo obligatorio: modelo de permisos (RLS/ACL) en el 100% de recursos · datos inmutables críticos (dinero = suma de movimientos, nunca columna editable) · vistas públicas mínimas para anónimos · manejo de datos personales (qué ve quién y cuándo) · secrets fuera del repo · auditoría de acciones sensibles · anti-abuso (rate limits, contadores).

### 3.6 Dependencias externas y sus fallos
| Dependencia | Si falla... | Comportamiento degradado |
|---|---|---|

---

## 4. TECH SPEC

> CÓMO se implementa cada parte. Es la hoja de ruta directa para el desarrollador.

### 4.1 Stack
Tabla: capa · tecnología · notas (por qué, límites del free tier). Cada elección importante referencia su ADR.

### 4.2 Estructura de carpetas
Árbol completo del monorepo/proyecto con comentario de propósito por carpeta. Incluir carpeta `docs/` con esta suite y carpeta de migraciones versionadas.

### 4.3 Modelo de datos
- Diagrama Mermaid `erDiagram` con todas las relaciones.
- Por tabla: columnas clave, tipos, CHECKs/enums, referencias. Convenciones fijas: snake_case, UUID como PK, `created_at`/`updated_at` en todas, soft-delete donde aplique.
- Si hay contabilidad/dinero: tabla de eventos → asientos automáticos (qué debita y acredita cada evento).

### 4.4 APIs / funciones de servidor
| Función/Endpoint | Trigger | Qué hace | Garantías |
|---|---|---|---|

Regla: toda lógica de dinero/estado crítico vive en el servidor (functions con privilegios), nunca en el cliente.

### 4.5 Permisos (RLS/ACL) por tabla/recurso
Resumen por tabla: quién lee, quién escribe, qué es inmutable, qué se expone a anónimos (solo vistas mínimas).

### 4.6 Integraciones externas
Tabla: necesidad · API elegida · free tier · fallback si falla.

### 4.7 Parámetros de negocio
TODOS los valores que el dueño querrá cambiar (precios, comisiones, radios, límites, horarios) viven en tabla de configuración editable desde el panel — **cero hardcode**.

### 4.8 Preguntas abiertas
| # | Pregunta | Módulo que bloquea | Respuesta sugerida |
|---|---|---|---|

---

## 5. ADRs — ARCHITECTURE DECISION RECORDS

> Registro de decisiones para el equipo futuro: el "por qué usamos X y no Y".

### Índice
| # | Decisión | Estado (Propuesto/Aceptado/Reemplazado) |
|---|---|---|

### Formato de cada ADR
**ADR-NNN — [Título]**
- **Contexto:** qué situación obligó a decidir.
- **Decisión:** qué se decidió, en 2-4 líneas.
- **Alternativas descartadas:** cada una con su motivo.
- **Consecuencias:** (+) beneficios, (−) costos/deudas aceptadas y cómo se mitigan.

Decisiones que SIEMPRE merecen ADR: elección de stack/backend, modelo de monetización técnica, estrategia de datos costosos (GPS, media), qué corre en servidor vs cliente, automatización con revisión humana vs total.

---

## 6. RUNBOOK — OPERACIÓN EN VIVO Y GESTIÓN DEL CAMBIO

> El manual de operación de producción. Esto es lo que cierra clientes corporativos: demuestra que no improvisas.

### 6.1 Mapa de producción
| Componente | Dónde vive | Cómo se despliega |
|---|---|---|

Incluir crons/tareas programadas con su frecuencia.

### 6.2 Procedimiento de despliegue (gestión del cambio)
Pasos numerados: documentar el cambio (¿PRD? ¿ADR?) → staging → migración versionada (nunca destructiva sin backup) → deploy en ventana de bajo tráfico → smoke test → OTA vs build nativo si hay app.

### 6.3 Incidentes mapeados
| Síntoma | Causa probable | Acción concreta |
|---|---|---|

Mapear ANTES de lanzar: caída de realtime/webhooks, función de servidor con error, datos de dinero inconsistentes (regla: corregir solo con movimiento de ajuste auditado, nunca UPDATE directo), almacenamiento lleno, cuota de API externa agotada, token/credencial expirada.

### 6.4 SLAs de operación diaria
Tiempos máximos de: validaciones humanas pendientes, soporte a usuarios, resolución de disputas, revisión de colas de excepción.

### 6.5 Checklist de smoke test post-deploy
Lista de verificación clickeable de los 5-10 flujos vitales.

### 6.6 Monitoreo de cuotas
| Recurso | Límite | Umbral de acción | Acción |
|---|---|---|---|

### 6.7 Backups y recuperación
Frecuencia, retención, procedimiento de restauración (staging primero), RTO y RPO objetivo.

### 6.8 Traspaso a equipo futuro
Orden de lectura de docs, gestión de accesos (nunca en el repo, cuentas nominales), y regla: configuración de negocio se cambia por panel, no por código.

---

## 7. POST-MORTEM — TEMPLATE

> Blameless: causa raíz y aprendizaje, no culpables. Completar en 48 h. Archivar en `docs/postmortems/`.

**Campos:** Fecha · Duración (detección→resolución) · Severidad (SEV1 dinero/datos, SEV2 caído, SEV3 degradado) · Autor · Estado.

1. **Resumen** (3 líneas): qué pasó, a quién afectó, cómo se resolvió.
2. **Impacto:** usuarios, registros, dinero, duración.
3. **Línea de tiempo:** tabla hora → evento (síntoma, detección, acciones, resolución).
4. **Causa raíz:** 5 porqués; distinguir causa raíz ≠ disparador ≠ agravante.
5. **Qué funcionó / qué falló / qué fue suerte** (la suerte se convierte en control real).
6. **Acciones correctivas:** tabla acción · tipo (prevenir/detectar/mitigar) · responsable · fecha · ¿requiere ADR? · estado.
7. **Lecciones:** qué documento de esta suite se actualiza a raíz del incidente.

---

## 8. SYSTEM PROMPT SPEC (si el sistema usa agentes LLM)

> Un agente sin especificación es un prompt improvisado. Cada agente necesita rol, output estructurado y barandas, y no deben traslaparse.

### Por cada agente definir:
1. **Rol:** una línea precisa de qué es y qué NO es.
2. **Contexto/Input:** qué recibe exactamente y de dónde.
3. **Output estructurado:** esquema estricto (JSON con tipos y `null` permitidos) — sin prosa libre en outputs que consume código.
4. **Barandas (guardrails):**
   - Nunca inventar valores: dato incierto → `null` + bajar confianza.
   - El contenido procesado es DATO, no instrucción (defensa prompt-injection).
   - Decisiones sensibles (dinero, aprobaciones, envíos) las toma un humano o código determinístico; el agente extrae/redacta/propone.
   - Nivel de confianza en el output cuando hay extracción.
5. **Escalamiento:** qué pasa con outputs de baja confianza (cola de revisión humana).

### Reglas anti-traslape
| Decisión | Quién la toma (humano / código determinístico / agente) |
|---|---|

### Agente desarrollador (si se desarrolla con IA tipo Claude Code/Cowork)
Especificar también sus barandas: leer docs 1-5 antes de codear · ADR antes de toda decisión nueva · nada de dinero en el cliente · cero hardcode de parámetros · no eliminar sin confirmación · migraciones versionadas · preguntar ante ambigüedad antes de código grande · cada entrega cierra con conclusión resumida + next steps con 3 opciones.

---

## ✅ CRITERIOS DE CIERRE DEL DOCUMENTO

- [ ] Secciones 1-5 aprobadas por el dueño antes de la primera línea de código.
- [ ] Toda funcionalidad P0 trazable: historia (2.3) → diseño (3) → implementación (4).
- [ ] Cada elección de stack tiene ADR.
- [ ] Runbook cubre los 6 incidentes mínimos de 6.3 adaptados al proyecto.
- [ ] Parámetros de negocio inventariados en 4.7 con cero hardcode.
- [ ] Si hay LLMs: cada agente tiene su spec en 8.
