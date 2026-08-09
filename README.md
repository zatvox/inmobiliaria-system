# Sistema de Gestión Inmobiliaria — Luis

Sistema propio (uso interno, una sola empresa) para administrar una cartera de inmuebles: propiedades, secciones (pisos/deptos/lotes), inquilinos/compradores/propietarios, contratos, cobranzas, pagos y — módulo propio — **Cálculo de Servicios** (luz, agua y otros consumos).

**Stack:** HTML + CSS modular + JavaScript vanilla (ES Modules) + [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage + RLS) · Hosting: GitHub Pages.

> ⚡ **Login solo con correo, sin contraseña por ahora.** Escribes tu email, te llega un enlace de acceso ("magic link"), haces clic y entras directo — la seguridad real la sigue dando RLS (`rls-policies.sql`), no la ausencia de contraseña. Ver `SETUP.md` pasos 6-7 (SITE_URL + Redirect URLs) y paso 4 para asignarte el rol de administrador la primera vez.

## Estado actual: Fase 1 de 5

Este sistema se está construyendo **por fases**, revisando cada módulo con Luis antes de avanzar (ver `docs/ADDENDUM-SECCIONES-SERVICIOS.md`, sección 6).

| Fase | Contenido | Estado |
|---|---|---|
| **1** | Esquema completo de Supabase (todas las tablas del sistema) + RLS + datos semilla reales + módulos **Inmuebles y Secciones** + **Personas** | ✅ Entregado en esta versión |
| 2 | Contratos (alquiler y venta) + generación automática de cuotas | Pendiente |
| 3 | Cobranzas + Pagos (con tab "Servicios") + módulo **Cálculo de Servicios** (medidores, lecturas, recibos, cálculo de consumo) | Pendiente |
| 4 | Ventas (pipeline), Documentos, Reportes | Pendiente |
| 5 | Configuración completa (plantillas de contrato + generación de PDF), Usuarios y Roles, Notificaciones | Pendiente |

Aunque el esquema de base de datos (`assets/sql/schema.sql`) ya incluye **todas** las tablas necesarias para las 5 fases (para que las relaciones queden consistentes desde el inicio), la interfaz web solo tiene construidos los módulos de la Fase 1. El menú lateral muestra el resto de módulos marcados como "Próximamente" con la fase en la que llegan.

## Requisitos

- Navegador moderno (Chrome, Edge, Firefox, Safari — últimas 2 versiones). No requiere Node.js ni build step: es HTML/CSS/JS puro.
- Cuenta gratuita de [Supabase](https://supabase.com).
- Cuenta de GitHub (para publicar en GitHub Pages).

## Estructura de carpetas

```
inmobiliaria-system/
├── index.html                 # Dashboard principal
├── pages/
│   ├── login.html              # Autenticación (Supabase Auth)
│   ├── inmuebles.html          # Módulo Inmuebles + Secciones
│   └── personas.html           # Módulo Personas
├── assets/
│   ├── css/
│   │   ├── variables.css       # Paleta de colores, tipografía, espaciado
│   │   ├── styles.css          # Layout global (sidebar, topbar, tipografía base)
│   │   ├── components.css      # Botones, tarjetas, modales, tablas, badges, toasts…
│   │   └── responsive.css      # Breakpoints 320/640/1024/1440/1920
│   ├── js/
│   │   ├── config.js            # URL y anon key de Supabase (EDITAR ANTES DE USAR)
│   │   ├── supabase-client.js   # Cliente Supabase (singleton)
│   │   ├── auth.js              # Login/logout, rol del usuario actual
│   │   ├── supabase-data.js     # Capa de datos (queries y mutaciones)
│   │   ├── main.js              # Shell de la app (sidebar, topbar, guardia de sesión)
│   │   ├── utils.js             # Helpers (toasts, modales, formatos, validación)
│   │   ├── dashboard.js         # Lógica de index.html
│   │   ├── inmuebles.js         # Lógica de pages/inmuebles.html
│   │   └── personas.js          # Lógica de pages/personas.html
│   └── sql/
│       ├── schema.sql            # Estructura completa de tablas (todas las fases)
│       ├── rls-policies.sql      # Row Level Security por tabla
│       └── seed.sql              # Datos reales de las 3 propiedades de Luis
└── docs/
    └── ADDENDUM-SECCIONES-SERVICIOS.md   # Decisiones de diseño de Secciones,
                                            # Agentes/Comisiones y Cálculo de Servicios
```

(Ver también `SPECS-SISTEMA-INMUEBLES.md`, `PROMPT_MAESTRO_SISTEMA_WEB_FULLSTACK.md` y `PLANTILLA-MAESTRA-ARQUITECTURA-SISTEMAS.md` en la raíz del proyecto — son los documentos base sobre los que se construyó todo esto.)

## Guía de uso rápido (una vez configurado — ver `SETUP.md`)

1. Entra a `pages/login.html` con el usuario que Luis te creó en Supabase Auth.
2. **Inmuebles**: registra un predio/edificio (dirección, tipo, propietario) y dentro de él crea sus **secciones** (pisos, departamentos, dúplex, lotes). Cada sección tiene su propio estado, precio y si tiene o no medidor propio de luz/agua.
3. **Personas**: registra inquilinos, propietarios, compradores o agentes — una misma persona puede tener varios roles.
4. Las fases siguientes (Contratos, Cobranzas, Pagos, Cálculo de Servicios) se habilitan según se vayan entregando.

## Concepto clave: Propiedades vs. Secciones

Una **propiedad** es el predio/edificio físico (ej. "Edificio República de Polonia 721"). Una **sección** es la unidad real que se alquila, se vende o se le calcula consumo (ej. "Piso 1-2 Dúplex", "Depto 301", "Lote 15"). Todo lo demás del sistema (contratos, cobranzas, medidores) se ancla a la **sección**, no a la propiedad. Ver `docs/ADDENDUM-SECCIONES-SERVICIOS.md` para el detalle completo.

## Datos ya cargados (seed)

`assets/sql/seed.sql` carga las 3 propiedades reales que Luis compartió (Av. República de Polonia 721, Av. Santa Rosa de Lima Mz. S, Calle Ámsterdam 280) con sus secciones e inquilinos conocidos. **Varios montos y datos están marcados como "por confirmar"** porque se dieron de memoria con dudas — revísalos en el módulo Inmuebles y corrígelos ahí directamente.
