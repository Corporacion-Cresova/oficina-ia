# Qué falta para que funcione igual que la oficina original

Respuesta a: *"¿hay algún otro archivo o dependencia que falte?"*

## 1. El plugin `motion-video-director` — NO se incluye

- Es un plugin del catálogo de Claude, **no es código del dueño de la oficina**, y por eso no se puede redistribuir en este paquete. Tampoco existe como carpeta en su PC.
- La oficina original lo usa así: `agents.mjs` (agentes de video) declara `plugins: ['motion-video-director']`, y `runner.mjs` lo carga desde `/data/plugins/motion-video-director` como plugin local de Claude (`.claude-plugin/plugin.json`). La agente de video (`prompts/video.md`) lo invoca con la herramienta Skill.
- **Es una función de Claude, no de OpenAI.** En una versión con OpenAI hay que reemplazarlo por guías propias en texto (diseño visual, voz, sonido, entrega). Como punto de partida sirven `TASTE.md` y `videos/09-cinco-cosas/plan/` de este paquete, que muestran las decisiones reales de un video.
- **El motor de render no depende del plugin.** `render.js` solo necesita Playwright, Chromium y ffmpeg. El plugin es la guía que sigue la agente para *decidir* qué dibujar.

## 2. El `Dockerfile` del repositorio no instala el estudio de video

El repositorio trae un Dockerfile mínimo. Faltan ffmpeg, Chromium, `playwright@1.49.1` y `three@0.170.0` en `/opt/estudio`, y las variables `ESTUDIO_TOOLKIT` y `PLAYWRIGHT_BROWSERS_PATH`. Las líneas exactas están en `Dockerfile.estudio.txt`. Sin eso, el Estudio de la oficina no renderiza.

## 3. Servicios externos que el código espera (no están en el repositorio)

| Variable | Servicio | ¿Obligatorio? |
|---|---|---|
| `DATABASE_URL` | Postgres propio (`cresova/schema.sql` crea las tablas) | Sí, para el módulo de negocio |
| `YCLOUD_API_KEY` o `EVOLUTION_*` | WhatsApp (YCloud oficial o Evolution API) | Sí, para el vendedor |
| `OPENROUTER_API_KEY` | Modelo del vendedor de WhatsApp (acepta modelos de OpenAI) | Sí, para el vendedor |
| `ELEVENLABS_*` | Voz, efectos y música de los videos | Para video con voz |
| `UPLOADPOST_*` | Publicación en TikTok / YouTube / Instagram / Facebook | Para publicar |
| `MAPS_SCRAPER_URL` | Servicio propio `tools/maps` (scraper de Google Maps) para prospección | No (solo prospección) |
| `SITIOS_URL` | Servicio propio `tools/sitios` (taller de páginas de clientes) | No (solo desarrollo web) |
| `PUBLIC_DEMOS_URL` | Proxy público de demos y del webhook `/hook/gastos` | No |

`tools/maps`, `tools/sitios` y el proxy de demos corren como servicios aparte en el servidor original. **Su código no está en el repositorio ni en este paquete.** Si los quieren, hay que pedirlos o reescribirlos; la oficina funciona sin ellos, con esas funciones apagadas.

## 4. Qué NO viene en este paquete, a propósito

- **Plugin `motion-video-director`:** ver punto 1.
- **Fuentes de Fontshare:** Clash Display, Cabinet Grotesk, Panchang, Gambetta, General Sans, Satoshi, Zodiak y Erode. Parecen ser de Fontshare (fontshare.com, descarga gratuita); no incluí los archivos para no redistribuir fuentes sin confirmar su licencia. Sin ellas el video se renderiza con fuente de respaldo. Descárgalas y ponlas en `assets/fonts/<Nombre>/`.
- **Videos de referencia de terceros** (`assets/refs`, 36 MB; el manifiesto original los registra como referencia, por ejemplo videos descargados de terceros) y **capturas web con marcas reales**.
- **Los otros 48 videos, cachés y renders.**
- **Voces:** el audio incluido (voz final, tema musical, efectos) se generó con la cuenta de ElevenLabs del dueño. Sirve de ejemplo; para producir deben generar los suyos con su cuenta, y comprobar que su plan permita uso comercial.
- **Logo de Cresova:** viene como ejemplo en `assets/brand/`. Reemplázalo por el de su marca; `src/cresova.js` lo carga desde ahí.

## 5. Contenido propio de Cresova que deben adaptar

- `TASTE.md` y `src/cresova.js` hablan de una agencia web en Honduras, con su paleta, tipografías y tono.
- El número de WhatsApp del cierre está como `+504 0000-0000`.
- Las llaves se leen solo de `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID`; las rutas locales del dueño se quitaron de los scripts.

## 6. Cambios que hice a esta copia respecto al original

- Quité teléfono, ID de voz y rutas locales.
- En `cresova.js` (ejemplo y plantilla), una fuente que no carga ya no bloquea el render (antes la página nunca llegaba a "lista").
- Añadí `assets/web/clinica-dental-5.png` (maqueta ficticia con fotos generadas) porque el video de ejemplo la usa.
