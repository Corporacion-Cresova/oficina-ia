# TASTE – Cresova · videos de Feed y anuncios (motion-video-director)
Updated: 2026-10-24 · by: Claude · current version: — (aún sin videos en este motor)
Status of this file: **approved style (locked) para §3 tipografía, subtítulos y logo**; resto en borrador (nada aprobado todavía en el motor nuevo; las reglas de §8–§9 sí vienen aprobadas de los 30 videos anteriores)
Visual version for the user: plan/design.html de cada video (pendiente)

## 1. Brief, concept & story
- **Qué hacemos:** videos cortos 9:16 para el Feed (IG/FB/TikTok/Shorts) y anuncios de Meta de Cresova, agencia de páginas web, asistentes de WhatsApp y marketing para negocios en Honduras.
- **Formato:** 1080×1920, 30 fps, 15–25 s.
- **Audiencia:** dueños de pequeños y medianos negocios en Honduras (no diseñadores). Hablarles de clientes, ventas, confianza y tiempo; la web es el mecanismo, no el producto.
- **CTA:** escribir por WhatsApp +504 0000-0000 / pedir demo gratis antes de pagar. Un solo CTA, dicho y mostrado ≥ 2 s.
- **Estructura:** gancho 0–3 s → problema → solución → prueba → CTA.
- **Pipeline:** A (todo dibujado en código, Canvas 2D + GSAP con seek). B (imágenes IA + código) solo para escenas que lo pidan.
- **Intensidad:** 4 en Feed y anuncios de prospección (social ads); 2–3 en anuncios de cierre (oferta, dudas).

## 2. Theme & feel
- **Mood:** ÉPICO · memorable · directo · confiable · moderno · catracho sin cliché. Regla de Diego (2026-10-24): "Cresova no tiene que tener comparación en su genialidad" — cada pieza debe sentirse muy por encima del mercado, nunca sencilla ni por defecto.
- **Mundo visual (receta A+B, plan/receta-referencias.md):** sistema editorial tipo HUD (esquinas, código de tiempo, barra de capítulos) en rojo/negro/crema; grotesca pesada + cursiva serif + mono; gancho cinemático con texto en profundidad, burbujas de WhatsApp y fugas de luz roja; todo gráfico (sin persona a cámara por ahora).
- **Referencias:** `C:\Users\Administrador\Desktop\Cresova-Videos\references\Referencia_Animaciones{,2,3}.mp4` (Giro): copiar técnicas (texto que sube desde máscara, UI simulada, cursor, contadores, cambios de fondo), nunca su marca.
- **NO debe sentirse como:** plantilla corporativa genérica, tráiler épico, video de "lleva tu negocio al siguiente nivel".

## 3. Visual design system
- **Paleta (60-30-10):** fondo carbón `#121212` o crema `#ECE7DC` · texto blanco `#FFFFFF` / carbón `#121212` · acento rojo Cresova `#E20018` (solo palabra clave, CTA y objetos de foco). Escena roja completa permitida (sin objetos rojos encima).
- **Tipografía (aprobada 2026-10-24, combinación D Showreel):** titulares Clash Display Bold 700 (`assets/fonts/Clash Display/`), 150–190 px, mayúsculas, interlineado 1.02; idea emocional Gambetta Medium Italic 500 (`assets/fonts/Gambetta/`), 90–120 px, minúscula con punto final, en rojo sobre crema / crema sobre carbón; subtítulos e interfaz Satoshi Bold 700 / Black 900 (`assets/fonts/Satoshi/`); HUD JetBrains Mono 500, 22 px. Licencias: ITF FFL (Fontshare) + OFL. No redistribuir las fuentes de Fontshare.
- **Subtítulos (aprobado 2026-10-24, estilo 2 Editorial):** Satoshi Bold 60 px en minúscula, centrados a y≈1350, 2–4 palabras por grupo (de beats.json); la palabra clave del grupo en Gambetta Italic roja a 1.35×. Sobre oscuro: blanco + sombra suave (blur 22, 55 %) + contorno fino 5 px; sobre crema: carbón sin contorno. Nunca caja negra; nunca mayúsculas con contorno grueso.
- **Layout 9:16:** nada importante en los 269 px de arriba ni en los 384 px de abajo; margen derecho 140 px para la interfaz de la app.
- **Logo:** SVG oficial `assets/brand/Cresova_Logo.svg` recoloreado SIN recuadro: sobre carbón letras blancas + C roja; sobre crema letras carbón + C roja; sobre rojo letras blancas + C carbón. Nunca la ficha blanca (Diego, 2026-10-24). Nunca dibujarlo ni pedirlo a una IA.

## 4. Motion language
- Pendiente de aprobar en el primer design.html. Base del plugin: entradas easeOutExpo/Cubic 200–500 ms, salidas más rápidas, escalonado 40–80 ms, sobrepaso 5–10 %, un solo foco por momento.
- **Regla fija de gancho:** el titular completo y el objeto principal ya están en el frame 0; la animación ocurre encima, no lo revela.

## 5. Sound identity
- **Generación:** ElevenLabs Sound Effects (`eleven_text_to_sound_v2`), con aprobación de lote y presupuesto antes de cada generación.
- **Reglas:** un sonido por evento visual importante (clic, tarjeta, palabra clave, transición), secos y cortos; voz siempre por encima (SFX 5–10 dB debajo).
- **Música (aprobada 2026-10-24):** cama electrónica minimalista ~120 BPM, muy baja bajo la voz, generada con ElevenLabs Music; cortes de escena en el beat.
- **Mezcla:** −16 LUFS integrado (preferencia de Diego: voz más baja que −14), TP ≤ −1.5 dBTP.

## 6. Voice
- **Proveedor:** ElevenLabs (plan Starter, 115,000 créditos/mes).
- **Voz (aprobada 2026-10-24):** **El Faraón** (colombiano, grave y expresivo), voice_id (poné el tuyo en ELEVENLABS_VOICE_ID), modelo `eleven_multilingual_v2`. Ajustes de partida: stability 0.5, similarity 0.75, style 0, speaker boost on; afinar en el primer guion completo para acercarse a la energía de G7. Medición: F0 ~92 Hz, variación 4.5 st, ~3.6 palabras/s. Respaldo: Brian C. Muestras en `assets/vo/pruebas/`.
- **Guion:** frases cortas, 40–50 palabras por video, en "tú", sin enumeraciones largas.

## 7. Technical setup
- **Espacio:** `C:\Users\Administrador\Documents\Claude\cresova-motion\` (Playwright 1.49.1 + Chromium, Node 24, ffmpeg 8.1, Python 3.12).
- **Render:** `node src/render.js --from <s> --to <s> --fps 30 --scale 1 --out renders/final --name "<Video> - Final v1" --audio <mix.wav>`.
- **Vista previa:** `node "<skill>/scripts/preview.mjs" <from> <to> --name "<Video>" --version <n>`.
- **Tiempos:** solo en `plan/beats.json`, sacados de los tiempos por palabra de la voz.
- **Estudio 3D:** el compositor lleva un pase Sanitize (NaN/inf → negro) ANTES del bloom; sin él un solo píxel NaN se expande en un bloque negro de medio cuadro (el "cuadro negro" de 03 en 0:04.5). Solo se ve a escala 1, no en vistas previas reducidas → revisar cada render final con `node scripts/scan_negro.mjs <mp4>` (marca saltos de negro; confirmar a ojo).
- **Subtítulos:** un grupo de más de ~28 caracteres se sale del ancho → partirlo en beats.json.

## 8. Do / Don't
- DO: hablar en "tú"; un concepto por video; titular corto (2–5 palabras) distinto del subtítulo; datos de ejemplo marcados "EJEMPLO"; enfoque Honduras ("negocio catracho").
- DON'T: inventar clientes, cifras o resultados; precios bajos; atacar a otros proveedores; jerga técnica (React, hosting, API); repetir el mismo texto en titular y subtítulo; caja negra detrás de los subtítulos.

## 9. Feedback rules log (append-only)
| Fecha | Versión | Diego dijo | Regla |
|---|---|---|---|
| 2026-10-22 | Feed v1 | "muy sencilla" (imagen 3D estática + zoom) | Movimiento real de interfaz y texto cinético, nunca una imagen estática con zoom |
| 2026-10-22 | Feed v2 | Pidió más variedad | Cada video distinto en composición, objeto, interacción y cierre; repetir solo cada ~30 videos |
| 2026-10-22 | Tanda 1 | Voz muy alta | Mezcla final a −16 LUFS |
| 2026-10-24 | Ganchos | Aprobó arreglo de ganchos | Titular completo en el frame 0 |
| 2026-10-24 | design v1 | "ese recuadro blanco no se mira bien" | Logo sin recuadro: SVG recoloreado según el fondo |
| 2026-10-24 | design v1 | subtítulos y fuentes "no me terminan de enamorar" | Fuentes con más carácter (Fontshare) y subtítulo más limpio que el contorno grueso en mayúsculas |
| 2026-10-24 | sonido v1 | "la música muy sencilla"; "no logro escuchar" los efectos | Nunca loudnorm en efectos cortos (solo ganancia de pico a -1 dBFS); música con textura y desarrollo, no solo bombo |
| 2026-10-24 | Preview v1 | "fondo totalmente rojo es molesto… la letra negra delgada se pierde" | Nunca fondo rojo a pantalla completa; el rojo es acento (palabra, pin, brillo, línea). Nunca cursiva delgada oscura sobre color |
| 2026-10-24 | Preview v1 | "escena final… desorden visual" con las fuentes | Cierre con jerarquía de máx. 3 niveles (logo → titular → acción) y alineación única; nada de mezclar mono + serif + pastillas en la misma pantalla |
| 2026-10-24 | Preview v1 | "falto de animaciones y movimiento" | Ningún cuadro quieto > 1 s: cámara que respira, golpes de zoom en los beats, partículas/brillos de fondo, objetos que flotan, entradas palabra por palabra |
| 2026-10-24 | Preview v1 | una repostería "no podría contratarnos" | Ejemplos = negocios con capacidad de inversión (clínicas, constructoras, distribuidoras, hoteles, despachos, colegios, transporte), siempre marcados EJEMPLO |
| 2026-10-24 | Preview v1 | "la voz super bien"; le gustaron los objetos y "lo del país" | Mantener El Faraón, los objetos de interfaz y el toque Honduras (mapa de puntos) |
| 2026-10-24 | Preview v2 | "demasiado movimiento"; el degradado blanco cuadrado sobre las letras "se mira mal" | Adorno discreto (polvo escaso, golpes de zoom suaves); brillos solo DENTRO de las letras, nunca un rectángulo encima |
| 2026-10-24 | Preview v2 | propone ONE TAKE "para dar ese asombro y diferencia" | Firma visual de Cresova: una sola toma continua; los cortes se vuelven movimientos de cámara que conectan objetos (punto → ficha → pin → tarjetas → logo) |
| 2026-10-24 | Look 3D v1 | pin "con la forma en 2D pero con un grosor… como los clásicos" | Objeto-personaje = pin clásico rojo con círculo blanco, plano con grosor 3D (no gota de vidrio); nunca de perfil total |
| 2026-10-24 | Tanda 1 (02–04) | "línea… fondo negro con opacidad no está completa hasta abajo" | La sombra inferior es un degradado continuo hasta el borde inferior (finish), nunca una banda que se corta |
| 2026-10-24 | Tanda 1 (02–04) | quiere páginas web "más bonitas" y reales en el teléfono | Capturas web generadas con Runware (GPT-Image 2.5 Sunburst, 864×1872) con negocio ficticio y etiqueta EJEMPLO; nada de páginas dibujadas con bloques |
| 2026-10-24 | Tanda 1 (02–04) | "cuadro negro tapando lo de la búsqueda" (su video 2 = nuestro 03, 0:04) | Era un NaN del bloom; pase Sanitize + escaneo de cada render final |

| 2026-10-25 | Tanda 2 | Cresova también vende agentes de IA y sistemas; quiere contenido educativo en el Feed | Cierre de marca con "WEB · AGENTES DE IA · SISTEMAS"; serie educativa "Cresova explica"; sistemas: nunca facturación; agentes y sistemas sin demo gratis → CTA "Escríbenos AGENTE por WhatsApp y agendamos una llamada" |

## 10. Decision history
- 2026-10-24 · motor HyperFrames (DOM) → motor del plugin (Canvas + Playwright) · decisión de Diego por calidad.
- 2026-10-24 · voz G7 (Runware) → ElevenLabs · decisión de Diego; voz exacta pendiente.

## 11. Continue-in-a-new-chat checklist
1. Leer este archivo completo, luego PROGRESS.md y el final de LOG.md.
2. Abrir el design.html aprobado y los últimos renders para VER el estilo antes de escribir código.
3. Reutilizar módulos y assets de §7; no cambiar paleta, fuentes ni set de sonidos sin aprobación.
4. Toda escena nueva debe cumplir §3–§5 y todas las reglas de §9.
