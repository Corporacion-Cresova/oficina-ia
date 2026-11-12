# Cómo convertirla en TU oficina

La plantilla ya no trae llaves, datos de clientes, ni IDs de cuentas del dueño original. Lo que sigue **sí** es del negocio original y hay que adaptarlo.

## 1. Datos de la empresa (ya son variables)
Pon en `.env`: `EMPRESA_RAZON_SOCIAL`, `EMPRESA_RTN`, `EMPRESA_CORREO`, `EMPRESA_WHATSAPP`, `OWNER_WHATSAPP`, `GIT_NOMBRE`, `GIT_CORREO`, `META_AD_ACCOUNT`, `META_PIXEL_ID`, `UPLOADPOST_FB_PAGE`, `DISCORD_OWNER_ID`, `DISCORD_VOICE_CHANNEL`.

## 2. Textos del negocio (hay que editarlos a mano)
Busca y reemplaza estas referencias. Con una búsqueda de `Cresova`, `Diego`, `Honduras`, `8,500`/`8500` y `HNL` encuentras todo:

| Dónde | Qué cambiar |
|---|---|
| `prompts/*.md` | Nombre de la empresa, del dueño ("Diego"), país, oferta y precios. Son la "personalidad" de cada agente |
| `prompts/media.md` | Sección "Cuenta Meta": completa con tu cuenta y lo que aprendas |
| `ventas/semilla.json` | Nombre del vendedor, empresa, oferta, objetivo del vendedor y **catálogo de precios** |
| `agents.mjs` | Nombres de los agentes y del vendedor ("Diego Villalta" es el nombre con que el vendedor se presenta) |
| `autonomia.mjs` | Límites de autonomía (tope de gasto en anuncios, notas mínimas de calidad) |
| `cresova/schema.sql` y `cresova/*.mjs` | Moneda, impuestos y formato de cotizaciones para tu país |
| `public/index.html` | Textos de la interfaz que mencionan al vendedor |
| `desarrollo/plantilla/` y `desarrollo/kit/` | Plantilla base de las páginas web que construye el taller |

## 3. Cuentas y servicios propios
Crea tus propias cuentas y llaves (todas opcionales, la función se apaga sin la llave): Claude, OpenRouter, YCloud o Evolution (WhatsApp), Meta, ElevenLabs, Upload-Post, Gemini, Runware, Discord, Resend, Google Calendar. La lista completa con comentarios está en `.env.example`. También se pueden cargar desde la oficina en **Sistema → Llaves**.

## 4. Base de datos
Crea un Postgres nuevo y ejecuta `cresova/schema.sql`. Parte vacía: no se comparten clientes ni cotizaciones del negocio original.

## 5. Qué NO viene incluido (a propósito)
- `.env`, llaves y `data/` (estado, conversaciones, entregables).
- El script de despliegue `deploy/` y todo lo que tenía credenciales, propuestas y PDFs de clientes.
- La base de datos, historial de WhatsApp y archivos de clientes.

## 6. Antes de publicar nada
Haz un recorrido en modo demo (`npm run demo`) y revisa la Bandeja: los agentes no deben publicar, gastar ni escribir a clientes hasta que apruebes cada acción.
