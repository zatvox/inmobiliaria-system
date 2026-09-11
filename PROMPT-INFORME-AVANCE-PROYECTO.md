# Prompt maestro — Informe de Avance de Proyecto (con capturas de sistema en vivo)

> Prompt reutilizable para pedirle a Claude que genere un **informe PDF de avance** de cualquier proyecto de software con servidor local (live server), combinando documentación técnica existente + capturas reales del sistema funcionando. Copiar/pegar y rellenar los campos entre `< >`.

---

## 1. Prompt para el usuario (rellenar y enviar a Claude)

```
Necesito un informe de avance de mi proyecto "<NOMBRE DEL PROYECTO>" para
presentar a <gerencia / cliente / stakeholder>. Quiero que se arme tomando
como base:

1. La documentación del proyecto (specs, README, arquitectura, addendums)
   que está en <ruta de la carpeta del proyecto>.
2. Capturas de pantalla reales del sistema funcionando, conectándote a
   <URL del live server, ej: http://127.0.0.1:5500/proyecto/index.html>.

El informe debe:
- Entregarse como <PDF / Word>.
- Tener una estructura de: cuerpo principal en lenguaje simple (no técnico,
  para <gerencia/cliente>) + un anexo técnico al final (también a nivel
  gerencial, sin código ni jerga profunda).
- Explicar claramente hasta dónde se ha avanzado y qué se puede usar/obtener
  YA del sistema (no solo lo que falta).
- Incluir 1 a 3 capturas por módulo (más si el módulo tiene pestañas/tabs
  internas — una captura por pestaña relevante).
- Usar párrafos cortos y concisos, tono ejecutivo.
- Cerrar con "Próximos pasos" y "Alcances" con recomendaciones concretas.

Ayúdame primero a definir bien la estructura antes de generar el documento.
```

---

## 2. Instrucciones para Claude (system/agent prompt)

Usa este bloque como guía de ejecución de principio a fin.

### 2.1 Fase 0 — Alinear alcance (antes de tocar código)

Antes de ejecutar nada, confirmar con el usuario (usar `AskUserQuestion` si hay ambigüedad):

- **Formato de salida**: PDF, Word, o ambos.
- **Estructura**: ¿cuerpo simple + anexo técnico al final? ¿o todo mezclado?
- **Profundidad**: ¿cuántas capturas por módulo? ¿tono ejecutivo o detallado?
- **Audiencia**: ¿100% no técnica, o también hay lectores técnicos que revisarán el anexo?
- **Alcance temporal**: ¿reporta todo el proyecto o solo una fase/sprint específico?

No generar el documento hasta tener esto claro. Documentar la decisión y seguir sin volver a preguntar.

### 2.2 Fase 1 — Investigación (research first)

Leer TODA la documentación relevante del proyecto antes de escribir una sola línea del informe:

- `README.md`, `ARCHITECTURE.md` / `ARQUITECTURA.md`
- Documentos de especificaciones (`SPECS-*.md`, `PROMPT_MAESTRO_*.md`)
- Addendums o decisiones de diseño posteriores (`docs/ADDENDUM-*.md`)
- Cualquier changelog, plan de fases, o backlog que indique qué está completo y qué falta

Extraer de esta lectura:
- Lista de módulos del sistema y su propósito de negocio (no solo técnico).
- Plan de fases (si existe) y estado de cada una.
- Decisiones de arquitectura clave y su justificación de negocio (no de código).
- Datos reales o de ejemplo relevantes para contextualizar (sin exponer datos sensibles si el informe va a terceros).

**Regla dura**: no invocar el skill de generación de PDF/Word ni escribir el documento final hasta terminar esta fase.

### 2.3 Fase 2 — Captura de pantallas del sistema en vivo

Objetivo: obtener 1 captura por módulo simple, y 1 captura por pestaña relevante en módulos con tabs internos (2-3 máximo por módulo).

**Pipeline de captura recomendado** (evita errores de transferencia de imágenes grandes):

1. Navegar al módulo con el navegador integrado (`mcp__Claude_Browser__navigate` o equivalente).
2. Si el módulo tiene pestañas, verificar el cambio de tab con una consulta rápida al DOM (texto/clase del tab activo) antes de capturar — un click por `ref` puede fallar silenciosamente; si eso ocurre, tomar un screenshot para obtener coordenadas exactas y hacer click por `coordinate`.
3. Cargar `html2canvas` dinámicamente si no está presente en la página (debe recargarse en cada navegación nueva):
   ```js
   if (!window.html2canvas) {
     await new Promise((resolve, reject) => {
       const s = document.createElement('script');
       s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
       s.onload = resolve; s.onerror = reject;
       document.head.appendChild(s);
     });
   }
   ```
4. Esperar ~500-800ms a que la vista termine de renderizar.
5. Capturar el área de contenido (no la página completa) con altura/ancho explícitos y un tope razonable (ej. `Math.min(target.scrollHeight, 1400)`) para evitar imágenes absurdamente largas y angostas:
   ```js
   const target = document.querySelector('.main-area') || document.body;
   const h = Math.min(target.scrollHeight, 1400);
   const canvas = await html2canvas(target, {
     scale: 1, backgroundColor: '#ffffff', useCORS: true,
     width: target.scrollWidth, height: h,
     windowWidth: target.scrollWidth, windowHeight: h
   });
   const b64 = canvas.toDataURL('image/jpeg', 0.9).slice(23);
   return b64.replace(/\+/g, '-').replace(/\//g, '_'); // base64url, evita problemas de escritura
   ```
6. Si la herramienta de ejecución de JS trunca o guarda el resultado en un archivo aparte por exceder el límite de tokens (comportamiento típico cuando el payload es grande), **usar ese archivo auto-guardado** como fuente de la imagen en vez de intentar escribir el base64 manualmente — es más confiable. Decodificar del lado del sandbox (ej. con un script Python que lea el JSON, tome el string base64url, revierta a base64 estándar y escriba el binario a `.jpg`).
7. Verificar cada imagen resultante (tipo de archivo, dimensiones) antes de darla por válida — descartar cualquier archivo que no sea un JPEG/PNG real.
8. Nombrar los archivos con prefijo numérico y nombre de módulo/pestaña, ej. `01_dashboard.jpg`, `06_servicios_medidores.jpg`, `07_servicios_lecturas.jpg`.

Repetir para cada módulo del sistema, en el orden en que aparecen en la navegación principal.

### 2.4 Fase 3 — Estructura del informe

Estructura estándar recomendada (ajustar según lo acordado en la Fase 0):

1. **Portada** — nombre del proyecto, "Informe de Avance", autor, fecha, plataforma/stack en una línea.
2. **Índice**.
3. **Resumen ejecutivo** — qué es el sistema, qué problema resuelve, cuántos módulos están funcionando, a quién está dirigido el informe.
4. **Estado actual del proyecto** — tabla de fases con contenido y estado (Completada / En curso / Pendiente), y un párrafo de síntesis de qué % del alcance total está cubierto.
5. **Qué se puede obtener ya del sistema** — lista concreta y accionable de capacidades disponibles hoy, en lenguaje de negocio ("se puede hacer X"), no de features técnicas.
6. **Recorrido por los módulos** — por cada módulo: Finalidad (1 línea) / Cómo funciona (1-2 líneas) / Qué información se obtiene (1 línea) + capturas con leyenda descriptiva corta. Módulos con pestañas van agrupados en un mismo bloque con sus 2-3 capturas.
7. **Próximos pasos y alcances** — lista de pendientes concretos (no vagos) + 3 recomendaciones numeradas y accionables para el destinatario.
8. **Anexo técnico** — stack tecnológico, modelo de seguridad/acceso, costos/mantenimiento, y el "por qué" de las decisiones técnicas clave — todo explicado a nivel gerencial, sin fragmentos de código ni jerga sin explicar.

### 2.5 Fase 4 — Redacción

Reglas de estilo:

- Frases cortas, sin relleno. Un párrafo no debe superar ~4 líneas.
- Cada módulo sigue el mismo patrón (Finalidad / Cómo funciona / Qué se obtiene) para que sea escaneable.
- Nunca dejar una sección solo con capturas sin texto que las explique, ni texto largo sin apoyo visual cuando hay pantalla disponible.
- El anexo técnico traduce términos técnicos a su implicancia de negocio (ej. "RLS" → "el acceso a cada dato se controla según el rol del usuario, sin depender de reglas escritas en el código").
- Evitar prometer fechas si no fueron confirmadas por el usuario; usar fases/hitos en vez de fechas si no se dieron.

### 2.6 Fase 5 — Generación del archivo

- Confirmar el research (Fase 1) esté completo antes de invocar el skill de generación de documento (`pdf` o `docx` según formato acordado) — nunca antes.
- Insertar las imágenes respetando la relación de aspecto original (no deformarlas), con un ancho máximo consistente en todo el documento y leyenda en cursiva debajo de cada una.
- Numerar páginas (excepto la portada) y agregar un pie de página con el nombre del proyecto.
- Verificar el documento final: contar páginas, revisar que ninguna imagen quedó corrupta o en blanco, y que el índice coincide con las secciones reales.
- Guardar el archivo final en la carpeta de trabajo del usuario (no solo en el scratchpad) y compartirlo explícitamente al finalizar.

---

## 3. Checklist final antes de entregar

- [ ] Todos los módulos principales del sistema están cubiertos con al menos 1 captura.
- [ ] Los módulos con pestañas tienen 2-3 capturas, una por pestaña relevante.
- [ ] El cuerpo principal no usa jerga técnica sin explicar.
- [ ] Existe una sección explícita de "qué se puede usar ya", no solo "qué falta".
- [ ] El anexo técnico está redactado a nivel gerencial.
- [ ] Hay una sección de próximos pasos con recomendaciones concretas (idealmente 3, numeradas).
- [ ] El PDF/Word fue verificado (páginas, imágenes, índice) antes de entregarse.
- [ ] El archivo quedó guardado en la carpeta del usuario y fue compartido.
