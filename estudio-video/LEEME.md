# Paquete de video (motor de render + proyecto de ejemplo)

Este paquete complementa el repositorio de la oficina de IA. Trae el **motor de video** que la oficina usa en su "Estudio", una **plantilla** para videos nuevos y **un video completo y editable** (`09-cinco-cosas`) para que se vea cómo está armado un proyecto real.

No incluye llaves ni contraseñas. Las llaves se ponen por variables de entorno (ver `FALTANTES.md`).

## Qué contiene

```
package.json / package-lock.json   playwright 1.49.1 + three 0.170.0
TASTE.md                           guía de estilo del video (ejemplo; adáptala a tu marca)
src/                               motor base (render.js, main.js, data.js, escenas)
scripts/                           utilidades: mezcla de audio, voces y efectos (ElevenLabs), detector de cuadros negros, cola de renders
videos/_plantilla/                 proyecto vacío para empezar un video nuevo
videos/09-cinco-cosas/             video completo: escenas (src/), guion y plan (plan/), voz (assets/vo/)
assets/brand/                      logo de ejemplo (reemplázalo por el tuyo)
assets/fonts/                      solo fuentes con licencia libre (OFL)
assets/sfx/, assets/marca-sonora/  efectos y tema musical usados por el ejemplo
assets/web/                        maqueta ficticia ("Clínica Dental Alba") usada en el ejemplo
```

## Cómo funciona (resumen)

Cada video es una página web que dibuja cada cuadro en un `<canvas>` (2D y 3D con three.js). El motor abre esa página con **Playwright/Chromium**, captura los cuadros uno por uno y los une con **ffmpeg** junto con el audio. Todo es determinista: sin relojes ni aleatorios en el render.

## Requisitos

- Node.js 20 o superior
- ffmpeg en el PATH (o variable `MVD_FFMPEG`)
- Chromium de Playwright (`npx playwright install chromium`)

## Probarlo en tu PC

```bash
npm ci
npx playwright install chromium

# prueba de 2 segundos a baja resolución (genera cuadros JPG)
node videos/09-cinco-cosas/src/render.js --from 0 --to 2 --fps 30 --scale 0.25 --out cache/humo --jpg

# render completo con audio (1080x1920)
node scripts/mezcla.mjs videos/09-cinco-cosas        # arma renders/mix.wav
node videos/09-cinco-cosas/src/render.js --from 0 --to 23 --fps 30 --scale 1 \
  --out videos/09-cinco-cosas/renders/previews --name "v1" --audio videos/09-cinco-cosas/renders/mix.wav
```

El video de ejemplo dura unos 23 s (el audio mezclado mide 22.98 s; la duración sale de `BEATS.duration` en `src/beats.js`).

Verificado desde una copia limpia de este paquete: la prueba de 2 s genera los 60 cuadros sin errores y `mezcla.mjs` produce `mix.wav`. **No probé el render completo a 1080×1920 con audio.**

**Fuentes:** las 8 fuentes de Fontshare no están incluidas (ver `FALTANTES.md`). Sin ellas el video se renderiza igual, con una fuente de respaldo; para el aspecto original descárgalas y ponlas en `assets/fonts/<Nombre>/`.

## Crear un video nuevo

1. Copia `videos/_plantilla` a `videos/<nombre>`.
2. Edita `src/beats.js` y `src/scenes/*.js`.
3. Genera la voz con `scripts/voz_tomas.mjs` (necesita `ELEVENLABS_API_KEY` y `ELEVENLABS_VOICE_ID`) o usa tu propia pista en `assets/vo/`.
4. Renderiza como arriba.

## Cómo se conecta con la oficina

La oficina (repositorio aparte) renderiza en su "Estudio":

- Espera el motor en `/data/estudio/` con la forma `videos/<nombre>/src/render.js` (así detecta qué videos existen).
- Las dependencias pesadas (`playwright`, `three`) y Chromium/ffmpeg van en la **imagen del servidor**, en `/opt/estudio` (variable `ESTUDIO_TOOLKIT`). El `Dockerfile` del repositorio no las trae: usa `Dockerfile.estudio.txt` de este paquete.
- El motor se sube empaquetado como `.tar.gz` al endpoint `POST /api/estudio/upload`, que lo descomprime en `/data/estudio`:

```bash
tar czf motor.tgz -C paquete-video-motor .
```
