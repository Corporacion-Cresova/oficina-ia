# Oficina de IA

Una oficina virtual donde un equipo de agentes de Claude trabaja con horario, roles y métricas: ventas por WhatsApp, marketing, video, publicación en redes, desarrollo de páginas web, cobranza y un CEO que coordina. Todo lo que publica, gasta o envía algo pasa por una **Bandeja de aprobación** del dueño.

> Esta es una **plantilla**. Fue creada a partir de una oficina real, así que parte de los textos (prompts, precios, país) están pensados para una agencia web en Honduras. Antes de usarla lee **[PERSONALIZAR.md](PERSONALIZAR.md)**.

## Qué necesitas

| Qué | Para qué |
|---|---|
| Node.js 20+ | correr la oficina |
| Credencial de Claude (`ANTHROPIC_API_KEY` o `CLAUDE_CODE_OAUTH_TOKEN`) | cerebro de los agentes. Sin ella arranca en modo demo |
| Un servidor (VPS) con Docker o EasyPanel | dejarla encendida 24/7 |
| Postgres | datos del negocio (`cresova/schema.sql` crea las tablas) |
| Tus propias cuentas | WhatsApp (YCloud/Evolution), Meta, ElevenLabs, Upload-Post, etc. Cada una es opcional: sin la llave, esa función queda apagada |

**Importante:** cada oficina usa *sus propias* llaves y su propia cuota de Claude. Nunca compartas tu `.env`.

## Probarla en local (sin credenciales)

```bash
npm install
npm run demo        # simula un día de trabajo
```

Abre http://localhost:3000.

## Correrla de verdad

```bash
cp .env.example .env     # completa al menos la credencial de Claude y OFFICE_PASSWORD
npm install
npm start
```

## Desplegar (EasyPanel / Docker)

1. Crea un servicio **App** con este repositorio y build por **Dockerfile**.
2. Monta un volumen en `/data` (estado, entregables, llaves cargadas desde la interfaz).
3. Carga las variables de `.env.example` (mínimo: credencial de Claude y `OFFICE_PASSWORD`).
4. Crea un servicio Postgres y ejecuta `cresova/schema.sql`; pon su URL en `DATABASE_URL`.
5. Asigna un dominio al puerto 3000.

## Estructura

| Carpeta / archivo | Contenido |
|---|---|
| `server.mjs`, `runner.mjs`, `agents.mjs` | servidor, ejecución de agentes y su definición |
| `prompts/` | la personalidad y reglas de cada agente (**lo principal a adaptar**) |
| `ventas/` | vendedor de WhatsApp, citas, recontacto, calidad de leads |
| `cresova/` | módulos de negocio: cotizaciones, cobros, tesorería, clientes (nombre histórico) |
| `pauta/`, `prospeccion/`, `desarrollo/` | anuncios, prospección y taller de páginas web |
| `estudio.mjs`, `videos.mjs`, `publicador.mjs`, `voz.mjs` | video, publicación y voz |
| `conocimiento/` | guías de marketing/ventas que consultan los agentes (con sus licencias en `licencias/`) |
| `public/` | la interfaz web |

## Seguridad

- Bash está deshabilitado para los agentes; cada uno trabaja en su carpeta `/data/workspace/<agente>`.
- Las acciones que publican, gastan, envían o borran requieren aprobación (`GATED_PATTERNS` en `agents.mjs`).
- `AGENT_MAX_BUDGET_USD` limita el gasto por corrida.
- No publiques la oficina sin `OFFICE_PASSWORD`.
- `data/`, `.env` y `secrets.json` nunca deben ir a git (ya están en `.gitignore`).
