# Ecuador Alerta

[![CI](https://github.com/BerlynDev/ecuador-alerta/actions/workflows/ci.yml/badge.svg)](https://github.com/BerlynDev/ecuador-alerta/actions/workflows/ci.yml)

Monitor casi en tiempo real de **focos de calor e incendios y eventos naturales en Ecuador**, con datos satelitales de la NASA (FIRMS y EONET) y **resúmenes en lenguaje claro generados por IA, anclados a los datos reales y verificados automáticamente**.

> 🇬🇧 [English version](README.md) · Decisiones técnicas explicadas: [docs/DECISIONES.md](docs/DECISIONES.md)

## Qué hace

- **Mapa interactivo** de Ecuador continental (Galápagos como capa opcional) con focos de calor de FIRMS (coloreados por potencia radiativa o por confianza), eventos de EONET con íconos por categoría y límites provinciales.
- **Filtros**: últimas 24 h, 48 h o 7 días; tipo de evento; provincia; Galápagos sí/no.
- **Panel lateral**: cifras clave, tendencia de 7 días, listas de eventos, agrupaciones y focos más intensos, y detalle al hacer clic.
- **Resumen del día** y **Explicar este evento** con IA.
- **Agrupación de focos** (DBSCAN) para identificar incendios grandes.
- **Modo demostración** con datos sintéticos, sin necesidad de claves.

## Empezar

Requisitos: Node.js 22.9 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:5173. Arranca en modo demostración.

Para datos reales, pide una MAP_KEY gratuita en https://firms.modaps.eosdis.nasa.gov/api/map_key/, copia `server/.env.example` a `server/.env` y pon `DATA_MODE=live` y `FIRMS_MAP_KEY=tu_clave`. Para la IA, configura `LLM_PROVIDER` (`anthropic` u `openai` compatible) y su clave. Sin IA (la opción por defecto, gratis), la app genera los textos con plantillas deterministas. `server/.env.example` trae configuraciones listas para descomentar: Groq y Gemini (gratis), Ollama local y Claude.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | API (:8787) y web (:5173) con recarga en caliente |
| `npm test` | 52 pruebas automáticas |
| `npm run typecheck` | Verificación de tipos de los tres paquetes |
| `npm run build` | Compila la web y el servidor para producción |
| `npm start` | Sirve API + web compilada desde un solo proceso |
| `npm run build:provinces` | Regenera el archivo de provincias desde geoBoundaries |

El resto (arquitectura, API, configuración, despliegue y fuentes) está en el [README en inglés](README.md), y el porqué de cada decisión en [docs/DECISIONES.md](docs/DECISIONES.md).

Un foco de calor es una anomalía térmica detectada por satélite: puede ser un incendio, una quema agrícola o una fuente industrial. Este es un proyecto educativo, no un sistema oficial de alertas; para alertas oficiales sigue a la Secretaría Nacional de Gestión de Riesgos.
