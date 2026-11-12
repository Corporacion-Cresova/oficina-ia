// Llaves de los servicios, cargables desde Sistema. Se guardan solo en
// /data/secrets.json (permisos 600) y se aplican a process.env, que es de donde
// las leen las conexiones MCP, el estudio y el SDK. Nunca salen completas al navegador.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './state.mjs';

export const KEYS = [
  { env: 'CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude (tu suscripción)', group: 'Cerebro', help: 'Token de `claude setup-token`. Sin esto la oficina queda en modo demo. Al guardarlo, la oficina se reinicia sola.' },
  { env: 'GEMINI_API_KEY', label: 'Google Gemini', group: 'Estudio de video', help: 'Para que Jarvis vea videos de YouTube (YouTube bloquea al servidor; Google los abre por dentro). Gratis en aistudio.google.com → Get API key.' },
  { env: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', group: 'Estudio de video', help: 'Voz, efectos y música de los videos. elevenlabs.io → Developers → API Keys.' },
  { env: 'UPLOADPOST_API_KEY', label: 'Upload-Post', group: 'Redes', help: 'Publicar y leer métricas de TikTok, YouTube, Instagram y Facebook. app.upload-post.com → API Keys.' },
  { env: 'METAADS_TOKEN', label: 'Meta (anuncios y biblioteca)', group: 'Redes', help: 'Token de usuario del sistema (rol Empleado). Da los anuncios de Cresova y la Biblioteca de anuncios para espiar a la competencia.' },
  { env: 'YOUTUBE_API_KEY', label: 'YouTube Data API', group: 'Investigación', help: 'Gratis. Permite buscar los Shorts más vistos de cualquier país. Google Cloud → APIs → YouTube Data API v3 → Credenciales.' },
  { env: 'OPENROUTER_API_KEY', label: 'OpenRouter (vendedor)', group: 'Ventas', help: 'El cerebro del vendedor de WhatsApp: con una sola llave probás cualquier modelo. openrouter.ai → Keys → Create Key (una llave normal, NO la de administración/Provisioning). Necesita saldo cargado.' },
  { env: 'OPENAI_API_KEY', label: 'OpenAI (Whisper, opcional)', group: 'Ventas', help: 'Opcional. Los audios de WhatsApp ya se transcriben con OpenRouter (Gemini). Si cargás una llave de OpenAI, se usa Whisper en su lugar.' },
  { env: 'EVOLUTION_API_URL', label: 'Evolution API: dirección', group: 'Ventas', help: 'La URL de tu servidor de Evolution (WhatsApp), por ejemplo https://evolution.tudominio.com. Se usa en la fase 2, cuando el vendedor atienda de verdad.' },
  { env: 'EVOLUTION_API_KEY', label: 'Evolution API: llave', group: 'Ventas', help: 'La apikey global o de la instancia de Evolution.' },
  { env: 'EVOLUTION_INSTANCE', label: 'Evolution API: instancia', group: 'Ventas', help: 'El NOMBRE de la instancia de WhatsApp en Evolution (es: cresova). No el token de la instancia.' },
  { env: 'DISCORD_BOT_TOKEN', label: 'Discord: token del bot', group: 'Voz', help: 'Para hablar con Jarvis por voz en Discord. discord.com/developers/applications → tu aplicación → Bot → Reset Token. Al guardarlo, el bot se conecta solo.' },
  { env: 'DISCORD_OWNER_ID', label: 'Discord: tu ID de usuario', group: 'Voz', help: 'Solo se escucha a esta persona. Discord → Ajustes → Avanzado → Modo desarrollador, y clic derecho en tu nombre → Copiar ID de usuario.' },
  { env: 'ELEVENLABS_AGENT_ID', label: 'ElevenLabs: agente de voz', group: 'Voz', help: 'El agente conversacional que habla (ya está creado: agent_…). Usa la misma llave de ElevenLabs de arriba.' },
  { env: 'ELEVENLABS_VOICE_ID', label: 'ElevenLabs: voz de Jarvis (voice ID)', group: 'Voz', help: 'La voz con la que habla Jarvis. En elevenlabs.io → Voices, abrí la voz → Copy voice ID y pegala aquí. Al guardarla se le pone al agente al instante (la voz tiene que estar en tu biblioteca de ElevenLabs: "Add to my voices"). Vacío = queda la voz que ya tiene.' },
  { env: 'RUNWARE_API_KEY', label: 'Runware (fotos de las demos)', group: 'Estudio de video', help: 'Genera las fotos de las páginas con FLUX.2: unos US$ 0,0006 por foto normal y ~US$ 0,03 la de calidad alta. Se paga con tu saldo de Runware. my.runware.ai → API Keys → Create (una llave nueva llamada "Oficina").' },
  { env: 'CRESOVA_MCP_API_KEY', label: 'Cresova (sistema interno)', group: 'Sistema', help: 'cresova.com → Ajustes → Conexión de agentes (MCP).' },
  { env: 'YCLOUD_API_KEY', label: 'YCloud (WhatsApp oficial de ventas)', group: 'Ventas', help: 'El número de ventas por la API oficial de Meta con coexistencia (sigue en la app del teléfono). ycloud.com → Developers → API Keys. Después: Ajustes → WhatsApp de ventas → Usar la API oficial.' },
  { env: 'GOOGLE_CLIENT_ID', label: 'Google Calendar: Client ID', group: 'Ventas', help: 'Para que el bot agende reuniones por Google Meet en tu calendario. Google Cloud → APIs y servicios → Credenciales → Crear ID de cliente OAuth (Aplicación web). URI de redireccionamiento: https://marketing-oficina.emxfr6.easypanel.host/api/google/callback. Activá también la Google Calendar API.' },
  { env: 'GOOGLE_CLIENT_SECRET', label: 'Google Calendar: Client secret', group: 'Ventas', help: 'El secreto del mismo ID de cliente OAuth. Después de guardar los dos, abrí /api/google/conectar y aceptá el acceso con tu cuenta de Google.' },
  { env: 'RESEND_API_KEY', label: 'Resend (correos de prospección)', group: 'Ventas', help: 'Para mandar los correos de prospección desde tu dominio aparte. resend.com → API Keys → Create API Key (permiso Sending access). Antes verificá el dominio en resend.com → Domains.' },
  { env: 'DATABASE_URL', label: 'Base de datos de Cresova', group: 'Sistema', help: 'La base propia (Postgres en EasyPanel, servicio cresova-db): cotizaciones, proyectos, pagos, clientes, tareas y tesorería. La conexión interna postgres://… que muestra EasyPanel.' },
  { env: 'META_PIXEL_ID', label: 'Meta: dataset de conversiones', group: 'Redes', help: 'El ID del dataset al que la oficina le manda los eventos Lead (cotización creada) y Purchase (cotización aceptada).' },
  { env: 'META_CAPI_TOKEN', label: 'Meta: llave de la API de conversiones (opcional)', group: 'Redes', help: 'Administrador de eventos → CRM Cresova → Configuración → API de conversiones → Generar token de acceso. Si la dejás vacía, se usa la llave de anuncios de arriba.' },
  { env: 'SITIOS_API_KEY', label: 'Sitios (taller de páginas)', group: 'Sistema', help: 'La llave de la API de Cresova Sitios (servicio tools/sitios). Con ella, Desarrollo trabaja en Sitios: Luis y Ashley siguen funcionando aunque la oficina se caiga. Sin ella, la oficina usa su Desarrollo local.' },
  { env: 'GASTOS_API_KEY', label: 'Llave de gastos (n8n)', group: 'Sistema', help: 'La misma x-api-key que n8n ya usa para mandar los gastos del correo. En n8n solo cambiás la URL a https://demo.preview.cresova.com/hook/gastos (el resto queda igual).' },
];

const FILE = path.join(DATA_DIR, 'secrets.json');
const fromEnv = Object.fromEntries(KEYS.map((k) => [k.env, process.env[k.env]?.trim() || '']));
let saved = {};

try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { saved = {}; }
for (const k of KEYS) apply(k.env);

function apply(env) {
  const v = saved[env] || fromEnv[env];
  if (v) process.env[env] = v; else delete process.env[env];
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function setKey(env, value) {
  if (!KEYS.some((k) => k.env === env)) throw new Error('Llave desconocida.');
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length > 4000 || /\s/.test(v)) throw new Error('La llave no puede tener espacios ni saltos de línea.');
  if (v) saved[env] = v; else delete saved[env];
  persist();
  apply(env);
}

export function publicKeys() {
  return KEYS.map((k) => {
    const v = process.env[k.env] || '';
    return { ...k, set: Boolean(v), source: saved[k.env] ? 'panel' : v ? 'easypanel' : null, last4: v.length > 8 ? v.slice(-4) : '' };
  });
}

// Prueba real de las llaves que no son conexiones MCP.
export async function testKey(env) {
  const v = process.env[env];
  if (!v) return { state: 'missing' };
  const check = async (url, headers = {}) => {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (r.status === 401 || r.status === 403) return { state: 'invalid', detail: 'El servicio rechazó la llave' };
      return r.ok ? { state: 'ok' } : { state: 'unreachable', detail: `Respondió HTTP ${r.status}` };
    } catch (e) {
      return { state: 'unreachable', detail: e.name === 'TimeoutError' ? 'Sin respuesta a tiempo' : e.message.slice(0, 80) };
    }
  };
  if (env === 'GEMINI_API_KEY') return check(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(v)}`, {});
  if (env === 'ELEVENLABS_API_KEY') return check('https://api.elevenlabs.io/v1/user', { 'xi-api-key': v });
  if (env === 'YOUTUBE_API_KEY') {
    const r = await check(`https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=HN&key=${encodeURIComponent(v)}`);
    return r.detail === 'Respondió HTTP 400' ? { state: 'invalid', detail: 'Google rechazó la llave' } : r;
  }
  if (env === 'OPENROUTER_API_KEY') return testOpenRouter(v);
  if (env === 'DISCORD_BOT_TOKEN') return check('https://discord.com/api/v10/users/@me', { Authorization: `Bot ${v}` });
  if (env === 'RUNWARE_API_KEY') {
    try {
      const r = await fetch('https://api.runware.ai/v1', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v}` }, body: JSON.stringify([{ taskType: 'accountManagement', taskUUID: crypto.randomUUID(), operation: 'getDetails' }]), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403 || (j.errors?.length && /auth|key|unauthor/i.test(JSON.stringify(j.errors)))) return { state: 'invalid', detail: 'Runware rechazó la llave' };
      const bal = j.data?.[0]?.balance ?? j.data?.[0]?.credits;
      return r.ok && !j.errors?.length ? { state: 'ok', detail: `Funciona${bal != null ? ` · saldo US$ ${Number(bal).toFixed(2)}` : ''}` } : { state: 'unreachable', detail: `Respondió HTTP ${r.status}` };
    } catch (e) { return { state: 'unreachable', detail: e.message.slice(0, 80) }; }
  }
  if (env === 'OPENAI_API_KEY') return check('https://api.openai.com/v1/models', { Authorization: `Bearer ${v}` });
  if (env === 'DATABASE_URL') {
    try { const db = await import('./cresova/db.mjs'); db.reiniciar(); const n = await db.probar(); return { state: 'ok', detail: `Conectada · ${n} cotizaciones` }; }
    catch (e) { return { state: /password|auth/i.test(e.message) ? 'invalid' : 'unreachable', detail: e.message.replace(/postgres(ql)?:\/\/\S+/g, 'postgres://…').slice(0, 120) }; }
  }
  return null; // las demás se prueban como conexión MCP o al usarse
}

// Saldo de OpenRouter en dólares (null si no se puede leer). El vendedor de WhatsApp, ver_video y los recontactos dependen de él.
export async function saldoOpenRouter() {
  const v = process.env.OPENROUTER_API_KEY;
  if (!v) return null;
  try {
    const cr = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${v}` }, signal: AbortSignal.timeout(10000) }).then((x) => x.json());
    return cr?.data ? Number(cr.data.total_credits) - Number(cr.data.total_usage) : null;
  } catch { return null; }
}

// OpenRouter: la llave puede existir pero no servir para conversar (por ejemplo, una llave de
// administración o de otra cuenta). Se prueba con un mensaje real de 1 token.
async function testOpenRouter(v) {
  const h = { Authorization: `Bearer ${v}`, 'Content-Type': 'application/json' };
  try {
    const info = await fetch('https://openrouter.ai/api/v1/key', { headers: h, signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => ({}));
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: h, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ model: 'openai/gpt-4o-mini', max_tokens: 1, messages: [{ role: 'user', content: 'hola' }] }) });
    const j = await r.json().catch(() => ({}));
    const d = info?.data || {};
    const tipo = `${v.startsWith('sk-or-') ? 'formato OpenRouter' : 'NO tiene formato de OpenRouter (sk-or-…)'}${d.is_provisioning_key ? ', es una llave de ADMINISTRACIÓN: creá una llave normal en openrouter.ai → Keys → Create Key' : ''}${d.is_free_tier ? ', cuenta sin saldo cargado' : ''}`;
    // Saldo: ver_video (Gemini por OpenRouter) y el vendedor se frenan si baja del mínimo.
    const cr = await fetch('https://openrouter.ai/api/v1/credits', { headers: h, signal: AbortSignal.timeout(10000) }).then((x) => x.json()).catch(() => ({}));
    const saldo = cr?.data ? ` · saldo US$ ${(Number(cr.data.total_credits) - Number(cr.data.total_usage)).toFixed(2)}` : '';
    if (r.ok && !j.error) return { state: 'ok', detail: `Funciona (${tipo})${saldo}` };
    const msg = j.error?.message || `HTTP ${r.status}`;
    return { state: 'invalid', detail: `OpenRouter rechaza los mensajes: ${msg} (${tipo})` };
  } catch (e) {
    return { state: 'unreachable', detail: e.message.slice(0, 80) };
  }
}

