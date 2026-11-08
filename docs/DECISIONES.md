# Decisiones técnicas — Ecuador Alerta

Este documento explica **por qué** el proyecto está construido así. Está pensado para que puedas defender cada decisión en una entrevista: qué se eligió, qué alternativas había y qué se sacrifica.

---

## 1. Lo que encontré al revisar la documentación de la NASA (nov. 2026)

Antes de escribir código revisé la documentación oficial actual. Tres hallazgos cambiaron el diseño:

1. **Suomi NPP dejó de entregar datos nuevos el 2 de noviembre de 2026.** Muchos tutoriales usan `VIIRS_SNPP_NRT`; hoy devolvería datos viejos. Por eso las fuentes por defecto son **NOAA-20 y NOAA-21** (`VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT`), configurables por variable de entorno.
2. **El orden del bbox es distinto en cada API.** FIRMS usa `oeste,sur,este,norte`; EONET usa `minLon,maxLat,maxLon,minLat` (esquina superior izquierda y luego inferior derecha). Si te equivocas, EONET no da error: devuelve una lista vacía. Por eso la conversión vive en una sola función con prueba (`toEonetBBox`).
3. **El límite de días por consulta de FIRMS no es fiable de memoria.** La página oficial dice 1..10, pero otras fuentes recientes mencionan 1..5. En lugar de apostar, el cliente **divide ventanas largas en varias consultas** con fecha explícita (`planRequests`), con un máximo configurable (`FIRMS_MAX_DAY_RANGE=5`). Funciona con cualquiera de los dos límites.

Otro detalle: FIRMS a veces responde **HTTP 200 con un texto de error** ("Invalid MAP_KEY."). El cliente valida que la respuesta empiece con la cabecera CSV, no solo el código HTTP.

---

## 2. Arquitectura general

```
React + Leaflet  ──/api──►  Express  ──►  DataService ──► caché ──► FIRMS / EONET
                                     └─►  AiService   ──► caché ──► LLM (opcional)
```

### ¿Por qué Vite + Express y no Next.js?

| | Vite + Express (elegido) | Next.js |
|---|---|---|
| Caché en memoria | Funciona: un proceso vivo | En serverless cada invocación puede empezar en frío; hay que usar la caché de `fetch` o un servicio externo |
| Despliegue gratis | Un solo servicio en Render | Vercel, muy cómodo |
| Separación front/back | Explícita, fácil de explicar | Mezclada en un framework |

La caché de 30–60 min era un requisito central, y con un servidor normal es trivial y verificable con pruebas. Sacrifico la comodidad de Vercel. En producción **un solo proceso sirve la API y la web compilada**: una URL, sin CORS, y las claves nunca salen del servidor.

### Monorepo con tipos compartidos

`shared/` contiene el modelo de dominio (`Hotspot`, `NaturalEvent`, `Snapshot`…). Servidor y cliente importan los mismos tipos, así que si cambia la forma de los datos, TypeScript marca el error en ambos lados. Es un paquete "solo fuente": Vite lo compila para el navegador y `tsup` lo empaqueta dentro del servidor.

---

## 3. Normalización a un formato común

FIRMS entrega CSV plano; EONET entrega JSON anidado con geometrías Point o Polygon. Ambos se convierten en el servidor a dos tipos propios. El frontend **nunca ve el formato de la NASA**, así que agregar otra fuente (por ejemplo sismos del IG-EPN) solo requiere un nuevo cliente que produzca el mismo modelo.

Decisiones dentro de la normalización:

- **Confianza**: VIIRS usa letras (l/n/h) y MODIS porcentajes. Se mapean a una escala común `low/nominal/high` usando los cortes que documenta FIRMS (<30, 30–79, ≥80).
- **Hora**: FIRMS da `acq_time` como "545" (05:45 UTC). Se rellena con ceros y se convierte a ISO-8601 UTC.
- **Eventos con trayectoria** (tormentas): se usa la **última posición dentro de Ecuador**, no la última absoluta, porque una tormenta puede pasar por Galápagos y terminar a miles de km.

---

## 4. Caché: la decisión más importante del backend

**Siempre se descarga la ventana máxima (7 días, que pueden tocar 8 días UTC) una vez por TTL, y todos los filtros se aplican en memoria.**

Consecuencia: el número de llamadas a la NASA es **constante**, sin importar cuántos usuarios haya o cuántas combinaciones de filtros usen. Con 2 satélites × 2 regiones × 2 bloques de días + 2 llamadas a EONET son unas 10 peticiones cada 45 minutos.

Además, la caché (`server/src/lib/cache.ts`, ~50 líneas, sin dependencias) tiene dos comportamientos de producción:

1. **Coalescencia de peticiones**: si 50 personas entran con la caché fría, se hace **una** sola llamada y todos esperan la misma promesa.
2. **Stale-if-error**: si la NASA falla al refrescar, se sirven los datos anteriores marcados como desactualizados, y la UI lo avisa.

Y degradación parcial: si falla NOAA-21 pero NOAA-20 responde, se muestra lo que hay con una advertencia. Solo si fallan todas las fuentes se devuelve error.

¿Por qué no Redis? Una sola instancia en plan gratuito no lo necesita. La interfaz es pequeña, así que cambiarla por Redis después no toca a quien la usa.

---

## 5. Provincias y "qué cuenta como Ecuador"

El bbox de Ecuador continental incluye partes de **Perú y Colombia**. Si no se filtra, los incendios del norte de Perú inflarían las cifras.

- Cada foco se ubica en una de las 24 provincias con **point-in-polygon** (ray casting, en `lib/geo.ts`). Primero se prueba el bbox de cada provincia (barato) y solo si cae dentro se hace la prueba exacta.
- **Focos fuera de las provincias se descartan** (y se cuenta cuántos, en `meta.discardedOutsideEcuador`).
- **Eventos fuera de las provincias se conservan** con `province: null`. Un volcán colombiano junto a Carchi es relevante para Ecuador; los eventos son pocos y no distorsionan conteos.

Los límites vienen de **geoBoundaries (CC0)**, procesados con `scripts/build-provinces.mjs`, que corrige tildes ("Manabi" → "Manabí"), códigos ISO duplicados en la fuente y redondea coordenadas a 4 decimales (~11 m, muy por debajo del píxel de 375 m de VIIRS). El proceso es reproducible.

---

## 6. Agrupación de focos: DBSCAN

Para identificar incendios grandes entre detecciones dispersas.

¿Por qué DBSCAN y no k-means?
- No sabemos cuántos incendios hay (k-means necesita k).
- Los incendios tienen formas irregulares.
- Los focos aislados deben quedar como "ruido", no forzados a un grupo.

Parámetros: `eps = 2 km`, `minPoints = 3`. La búsqueda de vecinos usa una **cuadrícula** de celdas de tamaño eps, así cada punto solo revisa 9 celdas: casi O(n) en vez de O(n²). En el ecuador un grado de longitud ≈ un grado de latitud, así que celdas cuadradas en grados funcionan bien para Ecuador.

---

## 7. IA: que no invente cifras

El requisito era que el LLM use solo datos reales y no invente números. Un prompt que dice "no inventes" reduce el problema, pero **no lo elimina**. Por eso hay cuatro capas:

1. **Hechos calculados en código** (`ai/facts.ts`): totales, ranking por provincia, porcentajes, agrupaciones y fechas ya formateadas en hora de Ecuador. El modelo no hace aritmética ni convierte zonas horarias.
2. **Prompt restringido** (`ai/prompts.ts`): datos en un bloque `<datos>` en JSON, con la regla de que ese bloque es información, no instrucciones (higiene básica contra *prompt injection*, porque los títulos vienen de una API externa). Regla explícita: si no hay datos, decirlo.
3. **Verificación mecánica** (`ai/verify.ts`): se extraen todos los números del texto generado y se comprueba que cada uno exista en los hechos (aceptando redondeos, formato español "45,4" y separadores de miles). Si aparece un número no respaldado, **se descarta la respuesta** y se muestra un texto determinista.
4. **Transparencia**: la UI indica si el texto lo escribió la IA (y fue verificado) o si es automático.

Compromiso aceptado: la verificación es estricta y a veces rechazará una frase inofensiva. En un monitor de amenazas, un "texto automático" de más es mucho más barato que una cifra falsa dicha con seguridad.

Otras decisiones:
- **La app funciona sin IA.** Las plantillas deterministas (`ai/templates.ts`) generan resúmenes útiles. La IA mejora la redacción; no es un punto único de falla.
- **Proveedor intercambiable**: interfaz `LlmClient` con implementación para Claude (Messages API) y para cualquier API compatible con OpenAI (Groq, OpenRouter, Ollama local). Elegir proveedor es una variable de entorno. Uso `fetch` en lugar de SDKs: son dos peticiones HTTP pequeñas y así el formato queda visible.
- **Costo controlado**: respuestas en caché por hash de los hechos (mismos datos = cero llamadas extra) y límite de solicitudes por IP en los endpoints de IA. Los errores transitorios del LLM **no** se guardan en caché, para no fijar el texto de respaldo durante todo el TTL.

---

## 8. Modo demostración con un `fetch` falso

`DATA_MODE=mock` no reemplaza los clientes: reemplaza **la red**. `createMockFetch` responde a las URLs de FIRMS y EONET con datos sintéticos en el **mismo formato** (CSV y JSON) que las APIs reales.

Ventajas:
- Quien clone el repo (un reclutador) lo ve funcionar sin pedir claves.
- El modo demo ejercita exactamente el mismo código de URLs, parseo, normalización y caché que producción.
- Las pruebas son deterministas: datos generados con una semilla y un reloj congelado.

Los datos sintéticos imitan patrones reales (quemas de gas petrolero en Sucumbíos y Orellana, bosque seco en Loja, focos cruzando la frontera) y la UI muestra siempre un aviso de "Datos de demostración".

---

## 9. Frontend

- **Leaflet con renderizado en canvas** (`preferCanvas`): miles de círculos se dibujan mucho más rápido que como nodos SVG. Consecuencia: el canvas no entiende variables CSS, así que los colores del mapa se pasan como valores literales según el modo claro/oscuro.
- **Toda la configuración de la petición viaja al servidor y se valida con zod**; valores inválidos devuelven 400 con un mensaje claro.
- **Peticiones cancelables** (`AbortController`): si cambias filtros rápido, las respuestas viejas no pisan a las nuevas.
- **Accesibilidad**: foco visible, controles con etiquetas, listas navegables con teclado, `aria-live` en los textos de IA, `prefers-reduced-motion` respetado (también en la animación del mapa), modo oscuro automático.
- **Sin librería de gráficos**: la tendencia de 7 días es SVG propio (~40 líneas), con la misma rampa térmica del mapa.
- **Diseño**: una sola tipografía (Archivo) usando su eje de anchura (ancha para cifras, condensada para datos); base fría y neutra para que el único color fuerte sea el dato de calor; los eventos de EONET en azul para no confundirlos con calor.

---

## 10. Pruebas (47)

- **Unitarias**: URLs de FIRMS y división en bloques, CSV de VIIRS y MODIS, mapeo de confianza, orden de bbox de EONET, posición de eventos con trayectoria, point-in-polygon con las **provincias reales** (Quito → Pichincha, Puerto Ayora → Galápagos, punto en Perú → null), caché (coalescencia, TTL, stale-if-error), DBSCAN, verificación de cifras, formato de las peticiones a los LLM, validación de configuración.
- **Integración**: la API HTTP completa con `supertest`, en modo demo y reloj congelado: filtros, ventanas de tiempo, errores 400, resumen con LLM falso que inventa números (debe rechazarse), LLM que falla (debe usar plantilla).
- **CI**: GitHub Actions ejecuta typecheck, pruebas y build en cada push.

---

## 11. Limitaciones conocidas y siguientes pasos

- **Contexto adicional de los focos**: FIRMS NRT no trae el tipo de foco (vegetación, volcán, fuente industrial); los focos de quema de gas en la Amazonía aparecen como "incendios". Mejora posible: máscara de fuentes industriales conocidas.
- **Caché en memoria**: se pierde al reiniciar (el plan gratuito de Render se suspende sin tráfico). El servidor precarga la caché al arrancar para mitigarlo.
- **Galápagos usa UTC-6**, pero la tendencia diaria usa hora continental (UTC-5) por coherencia.
- **Polígonos simplificados**: algún foco justo en la costa podría quedar fuera.
- Ideas: alertas por correo cuando aparece una agrupación grande en una provincia, historial persistente (SQLite/Postgres), capa de sismos del IG-EPN, tests end-to-end del navegador con Playwright.

---

## 12. Preguntas probables en una entrevista

**¿Cómo evitas que la IA invente datos?**
Le doy solo hechos calculados en código, le prohíbo calcular, y verifico automáticamente cada número de su respuesta. Si algo no cuadra, muestro un texto determinista. La IA redacta; el código decide los datos.

**¿Qué pasa si la NASA se cae?**
Se sirven los últimos datos en caché marcados como desactualizados. Si solo falla una fuente, se muestra el resto con una advertencia.

**¿Cómo escalaría esto?**
El costo hacia la NASA ya es constante gracias a la caché de ventana máxima. Para varias instancias movería la caché a Redis (la interfaz ya está aislada) y pondría un CDN delante de `/api/snapshot`, que ya envía `Cache-Control`.

**¿Por qué no usaste k-means?**
Porque no sé cuántos incendios hay, tienen formas irregulares y los focos aislados no deben agruparse a la fuerza. DBSCAN resuelve los tres problemas.

**¿Por qué tantas pruebas para un proyecto personal?**
Porque las partes delicadas (orden de bbox, zonas horarias, límites de días, verificación de cifras) fallan en silencio: no lanzan errores, devuelven datos incorrectos. Solo las pruebas las detectan.
