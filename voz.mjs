// Voz: Diego habla con Jarvis en un canal de voz de Discord.
// Discord (bot) ⇄ agente conversacional de ElevenLabs ⇄ herramientas de la oficina.
// - Solo se escucha el audio de Diego (DISCORD_OWNER_ID); el de los demás nunca se recibe.
// - La sesión con ElevenLabs solo existe mientras Diego habla: se abre cuando empieza a hablar
//   y se cierra tras 20 s sin que nadie hable (se cobra por minuto de sesión abierta, hable o no). Si Diego vuelve a
//   hablar se abre otra al instante (su audio se guarda mientras conecta) con lo último que se dijo. Tope diario de minutos.
// - Las herramientas se ejecutan aquí adentro (estado, Bandeja, Jarvis): nada de la oficina se expone a internet.
// - Por voz no se aprueba nada: eso es solo en la Bandeja.
import { PassThrough } from 'node:stream';
import { state, log, listDeliverables, publicState, chatOf } from './state.mjs';

const OWNER = () => (process.env.DISCORD_OWNER_ID || '').trim();
// Solo entra a este canal de voz (el dueño no quiere que aparezca en los demás).
const CANAL = () => (process.env.DISCORD_VOICE_CHANNEL || '').trim();
const AGENT_ID = () => (process.env.ELEVENLABS_AGENT_ID || 'agent_8301m6erzwxvfjxrnqhr63wkk2b9').trim();
const MAX_MIN_DIA = Number(process.env.VOZ_MAX_MIN || 60);
const SILENCIO_CIERRE_MS = 20_000;
const CHUNK_MS = 100;

state.voz ||= { dias: {} };
state.voz.charla ||= [];

// ---------- memoria de la conversación (Jarvis es uno solo en voz, chat y WhatsApp) ----------
// Lo que se dice por voz se guarda (las sesiones con ElevenLabs se cortan tras 90 s de silencio y cada una
// arranca sin memoria). Al abrir una sesión, el agente de voz recibe lo último hablado por voz y lo último
// que Diego habló con Jarvis por chat y WhatsApp. Y Jarvis, en su próximo turno, recibe lo hablado por voz.
function anotarVoz(quien, texto) {
  const t = String(texto || '').trim();
  if (!t) return;
  state.voz.charla.push({ ts: Date.now(), quien, texto: t.slice(0, 600) });
  if (state.voz.charla.length > 80) state.voz.charla.splice(0, state.voz.charla.length - 80);
}
const hace = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
export function contextoReciente() {
  const partes = [];
  const voz = state.voz.charla.filter((x) => Date.now() - x.ts < 24 * 3600e3).slice(-16);
  if (voz.length) partes.push(`Lo último que hablaron por voz (empezó ${hace(voz[0].ts)}, terminó ${hace(voz.at(-1).ts)}):\n${voz.map((x) => `${x.quien === 'diego' ? 'Diego' : 'Vos'}: ${x.texto.slice(0, 260)}`).join('\n')}`);
  const msgs = (chatOf('coordinador').messages || []).filter((m) => Date.now() - m.ts < 48 * 3600e3 && !String(m.text).startsWith('🎙️')).slice(-8);
  if (msgs.length) partes.push(`Lo último que hablaron por chat o WhatsApp:\n${msgs.map((m) => `${m.role === 'user' ? (String(m.text).startsWith('📱') ? 'Diego (WhatsApp)' : 'Diego (chat)') : 'Vos'} · ${hace(m.ts)}: ${String(m.text).replace(/^📱\s*/, '').replace(/\s+/g, ' ').slice(0, 260)}`).join('\n')}`);
  return (partes.join('\n\n') || 'No hay conversación reciente con Diego.').slice(0, 4500);
}
// Lo hablado por voz que Jarvis (chat y WhatsApp) todavía no vio. Se marca como visto al leerlo.
export function vozSinVer() {
  const desde = state.voz.vistoHasta || 0;
  const nuevas = state.voz.charla.filter((x) => x.ts > desde && Date.now() - x.ts < 24 * 3600e3);
  state.voz.vistoHasta = Date.now();
  if (!nuevas.length) return '';
  return nuevas.slice(-24).map((x) => `${x.quien === 'diego' ? 'Diego' : 'Vos'}: ${x.texto.slice(0, 300)}`).join('\n');
}
const hoy = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const minutosHoy = () => (state.voz.dias[hoy()] || 0) / 60;
function sumarSegundos(s) { state.voz.dias[hoy()] = (state.voz.dias[hoy()] || 0) + s; for (const k of Object.keys(state.voz.dias).sort().slice(0, -14)) delete state.voz.dias[k]; }

const est = { listo: false, tag: null, canal: null, sesion: false, error: null };
export const vozStatus = () => ({ configurado: Boolean(process.env.DISCORD_BOT_TOKEN), conectado: est.listo, bot: est.tag, enCanal: est.canal, sesionActiva: est.sesion, minutosHoy: Math.round(minutosHoy() * 10) / 10, tope: MAX_MIN_DIA, error: est.error });

// ---------- audio ----------
const rateDe = (fmt, def = 16000) => { const m = /pcm_(\d+)/.exec(fmt || ''); return m ? Number(m[1]) : def; };
// PCM 16-bit estéreo a 48 kHz (Discord) → mono a `rate`, promediando muestras.
function bajar(buf, rate) {
  const n = Math.floor(buf.length / 4);
  const factor = 48000 / rate;
  const out = Buffer.alloc(Math.floor(n / factor) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const a = Math.floor(i * factor), b = Math.max(a + 1, Math.min(n, Math.floor((i + 1) * factor)));
    let sum = 0, c = 0;
    for (let j = a; j < b; j++) { sum += buf.readInt16LE(j * 4) + buf.readInt16LE(j * 4 + 2); c += 2; }
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / c))), i * 2);
  }
  return out;
}
// PCM mono a `rate` → estéreo a 48 kHz (interpolación lineal).
function subir(buf, rate) {
  const n = Math.floor(buf.length / 2);
  const factor = 48000 / rate;
  const total = Math.floor(n * factor);
  const out = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i++) {
    const pos = i / factor, i0 = Math.min(n - 1, Math.floor(pos)), i1 = Math.min(n - 1, i0 + 1), fr = pos - i0;
    const v = Math.round(buf.readInt16LE(i0 * 2) * (1 - fr) + buf.readInt16LE(i1 * 2) * fr);
    out.writeInt16LE(v, i * 4); out.writeInt16LE(v, i * 4 + 2);
  }
  return out;
}

// ---------- herramientas (las mismas para Discord y para la prueba) ----------
// Lo que de verdad espera a Diego: decisiones, videos por aprobar y permisos pendientes (lo mismo que cuenta el número de la Bandeja).
// Los informes sin leer son aparte: son lectura, no esperan una respuesta.
export function bandejaDatos() {
  const todo = listDeliverables();
  const decisiones = todo.filter((d) => d.kind === 'decision' && d.status === 'pending' && !d.paraCeo);
  const videos = todo.filter((d) => d.kind === 'video' && d.status === 'pending');
  const permisos = publicState().approvals || [];
  const informes = todo.filter((d) => d.kind === 'informe' && d.status === 'pending');
  return { decisiones, videos, permisos, informes };
}
export function bandejaTexto({ completo = false } = {}) {
  const { decisiones, videos, permisos, informes } = bandejaDatos();
  const n = decisiones.length + videos.length + permisos.length;
  if (!n && !informes.length) return 'La Bandeja está vacía: no hay nada esperando a Diego.';
  const lineas = [`Esperan a Diego ${n} cosas: ${decisiones.length} decisiones, ${videos.length} videos por aprobar y ${permisos.length} permisos de herramientas.`];
  for (const d of decisiones.slice().reverse().slice(0, completo ? 40 : 12)) lineas.push(`- ${d.agentId}: ${d.title}${d.question ? ` → ${d.question}` : ''}`.slice(0, completo ? 400 : 220));
  if (videos.length) lineas.push(`- Videos por aprobar en el Estudio: ${videos.length}.`);
  for (const p of permisos.slice(0, 8)) lineas.push(`- Permiso pendiente (${p.agentId}): ${p.tool || p.title || ''}`.slice(0, 160));
  if (informes.length) lineas.push(`Además hay ${informes.length} informes sin leer; son solo lectura, no urgen.`);
  return lineas.join('\n');
}
function estadoOficina() {
  const s = publicState();
  const { decisiones, videos, permisos, informes } = bandejaDatos();
  const trabajando = Object.entries(s.agents).filter(([, a]) => a.status !== 'idle').map(([id, a]) => `${id}: ${a.text}`.slice(0, 120));
  const tareas = (s.tasks || []).filter((t) => ['pendiente', 'en_progreso', 'espera', 'correcciones'].includes(t.status));
  return [
    `Esperan a Diego ${decisiones.length + videos.length + permisos.length} cosas en la Bandeja (${decisiones.length} decisiones, ${videos.length} videos, ${permisos.length} permisos). Informes sin leer, aparte: ${informes.length}.`,
    trabajando.length ? `Trabajando ahora: ${trabajando.join('; ')}.` : 'Nadie está trabajando ahora mismo; todos disponibles.',
    `Tareas abiertas en el tablero: ${tareas.length}${tareas.length ? ` (${tareas.slice(0, 5).map((t) => t.title).join('; ')})` : ''}.`,
  ].join(' ');
}
const verBandeja = () => bandejaTexto();
const limpio = (r) => String(r || 'Listo.').replace(/[*_#`]/g, '').slice(0, 900);
// Cada segundo que Jarvis habla se paga en ElevenLabs. Si el resultado es largo, el detalle completo va por Discord
// (gratis) y a la voz le llega con la instrucción de decir solo la conclusión.
function paraVoz(r) {
  const t = String(r || 'Listo.');
  if (t.length <= 320) return limpio(t);
  mensajeDiscord(t.slice(0, 6000)).catch(() => {});
  return `[El detalle completo ya se lo mandé a Diego por Discord. Decile SOLO la conclusión en una o dos frases y que el detalle está en Discord.] ${limpio(t)}`;
}
// Cuando el trabajo termina después de que la voz ya contestó: si la sesión sigue abierta se le cuenta a Diego
// en voz; si ya se cerró, le llega por Discord.
function avisarFin(r, enviarTexto) {
  if (sesion && !sesion.cerrada && enviarTexto) enviarTexto(`[Aviso interno, no lo dijo Diego] Terminaste el trabajo que te pidió. Resultado: ${paraVoz(r)} — Contáselo ahora en primera persona, en una o dos frases.`);
  else mensajeDiscord(`Listo con lo que me pediste por voz:\n\n${String(r || 'Listo.').slice(0, 1800)}`).catch(() => {});
}
async function usarOficina(pedido, enviarTexto) {
  const { chatAgent, isRunning } = await import('./runner.mjs');
  const texto = String(pedido).slice(0, 3000);
  // Si estoy terminando otra cosa en el chat o WhatsApp, espero en vez de pedirle a Diego que repita.
  const libre = async (ms) => { const fin = Date.now() + ms; while (isRunning('coordinador') && Date.now() < fin) await new Promise((r) => setTimeout(r, 2000)); return !isRunning('coordinador'); };
  if (!(await libre(6_000))) {
    (async () => {
      if (!(await libre(15 * 60_000))) { mensajeDiscord(`No pude hacer lo que me pediste por voz porque seguí ocupado 15 minutos: "${texto.slice(0, 300)}". Pedímelo de nuevo cuando quieras.`).catch(() => {}); return; }
      const r = await chatAgent('coordinador', texto, { canal: 'voz' }).catch((e) => `No pude: ${e.message}`);
      avisarFin(r, enviarTexto);
    })();
    return 'Estoy terminando otra cosa; apenas me libere lo hago y te cuento. Seguí hablando con Diego mientras tanto.';
  }
  const p = chatAgent('coordinador', texto, { canal: 'voz' });
  // Antes esperaba hasta 35 s callado (Diego lo oía "trabado"): ahora a los 12 s dice que lo está haciendo y avisa al terminar.
  const rapido = await Promise.race([p.then((r) => ({ r })), new Promise((res) => setTimeout(() => res(null), 12_000))]);
  if (rapido) return rapido.r === false ? 'Me agarró ocupado justo ahora; probá en unos segundos.' : paraVoz(rapido.r);
  p.then((r) => avisarFin(r, enviarTexto)).catch(() => {});
  return 'Lo estoy haciendo y me lleva un rato: apenas termine se lo contás a Diego. Seguí la conversación.';
}
async function ejecutarHerramienta(nombre, params, enviarTexto) {
  if (nombre === 'estado_oficina') return estadoOficina();
  if (nombre === 'ver_bandeja') return verBandeja();
  if (nombre === 'usar_oficina' || nombre === 'preguntar_a_jarvis') return usarOficina(params?.pedido || '', enviarTexto);
  throw new Error(`Herramienta desconocida: ${nombre}`);
}

// ---------- gasto de la voz (ElevenLabs) ----------
// Cada conversación trae su costo en créditos (voz + modelo) y en dólares. Se suma por día y se junta con el plan.
let gastoCache = { at: 0, v: null };
export async function gastoVoz({ forzar = false } = {}) {
  if (!forzar && gastoCache.v && Date.now() - gastoCache.at < 10 * 60e3) return gastoCache.v;
  const desde = Math.floor(Date.now() / 1000) - 30 * 86400;
  const convs = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const { r, j } = await el(`/v1/convai/conversations?agent_id=${encodeURIComponent(AGENT_ID())}&page_size=100&call_start_after_unix=${desde}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok) throw new Error(`ElevenLabs respondió ${r.status}`);
    convs.push(...(j.conversations || []));
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  const dia = (t) => new Date((t - 6 * 3600) * 1000).toISOString().slice(0, 10);
  const dias = {};
  let cortes = 0, porLimite = 0;
  for (const c of convs) {
    const d = (dias[dia(c.start_time_unix_secs)] ||= { llamadas: 0, minutos: 0, creditos: 0, usd: 0 });
    d.llamadas++; d.minutos += (c.call_duration_secs || 0) / 60; d.creditos += c.cost || 0; d.usd += c.cost_fiat || 0;
    if (/1006/.test(c.termination_reason || '')) cortes++;
    if (/maximum duration/i.test(c.termination_reason || '')) porLimite++;
  }
  const total = Object.values(dias).reduce((a, d) => ({ llamadas: a.llamadas + d.llamadas, minutos: a.minutos + d.minutos, creditos: a.creditos + d.creditos, usd: a.usd + d.usd }), { llamadas: 0, minutos: 0, creditos: 0, usd: 0 });
  // Desglose de las últimas 40 llamadas: Jarvis hablando (audio que generó), Diego hablando (~2,6 palabras por
  // segundo) y el resto, que es silencio cobrado (pausas, esperas de herramientas y la cola antes de cerrar).
  const desglose = { cobrado: 0, jarvis: 0, diego: 0, llamadas: 0 };
  for (const c of convs.slice(0, 40)) {
    const { r, j: d } = await el(`/v1/convai/conversations/${c.conversation_id}`).catch(() => ({ r: { ok: false } }));
    if (!r.ok) continue;
    desglose.llamadas++;
    desglose.cobrado += c.call_duration_secs || 0;
    desglose.jarvis += d.metadata?.charging?.tts_usage?.total_audio_output_seconds || 0;
    desglose.diego += (d.transcript || []).filter((t) => t.role === 'user' && !String(t.message || '').startsWith('[Aviso')).reduce((a, t) => a + String(t.message || '').split(/\s+/).filter(Boolean).length / 2.6, 0);
  }
  const { r: rs, j: sub } = await el('/v1/user/subscription').catch(() => ({ r: { ok: false }, j: {} }));
  gastoCache = { at: Date.now(), v: {
    dias: Object.entries(dias).sort(([a], [b]) => b.localeCompare(a)).map(([fecha, d]) => ({ fecha, ...d })),
    total, cortes, porLimite, desglose,
    plan: rs.ok ? { nivel: sub.tier, usados: sub.character_count, limite: sub.character_limit, renueva: sub.next_character_count_reset_unix ? sub.next_character_count_reset_unix * 1000 : null } : null,
  } };
  return gastoCache.v;
}

// ---------- voz del agente (Sistema → Llaves → voz de Jarvis) ----------
// Se cambia en el propio agente de ElevenLabs, así vale para todas las sesiones sin permisos de "override".
async function el(pathname, opts = {}) {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de ElevenLabs.');
  const r = await fetch(`https://api.elevenlabs.io${pathname}`, { ...opts, headers: { 'xi-api-key': key, 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

export async function aplicarVoz(voiceId = process.env.ELEVENLABS_VOICE_ID?.trim()) {
  if (!voiceId) return { state: 'missing' };
  const v = await el(`/v1/voices/${encodeURIComponent(voiceId)}`);
  if (v.r.status === 401) return { state: 'invalid', detail: 'ElevenLabs rechazó la llave' };
  if (!v.r.ok) return { state: 'invalid', detail: 'Esa voz no existe o no está en tu biblioteca de ElevenLabs (agregala con "Add to my voices")' };
  const nombre = v.j.name || voiceId;
  const a = await el(`/v1/convai/agents/${encodeURIComponent(AGENT_ID())}`);
  if (!a.r.ok) return { state: 'unreachable', detail: `No pude leer el agente de voz (HTTP ${a.r.status})` };
  const antes = a.j.conversation_config?.tts?.voice_id;
  const p = await el(`/v1/convai/agents/${encodeURIComponent(AGENT_ID())}`, { method: 'PATCH', body: JSON.stringify({ conversation_config: { tts: { voice_id: voiceId } } }) });
  if (!p.r.ok) return { state: 'unreachable', detail: `ElevenLabs no dejó cambiar la voz: ${String(p.j.detail?.message || JSON.stringify(p.j.detail || p.r.status)).slice(0, 160)}` };
  const ahora = p.j.conversation_config?.tts?.voice_id;
  if (ahora && ahora !== voiceId) return { state: 'unreachable', detail: 'ElevenLabs aceptó el cambio pero el agente sigue con otra voz' };
  if (antes !== voiceId) log('coordinador', `Voz de Jarvis cambiada a "${nombre}".`, 'system');
  return { state: 'ok', detail: `Jarvis habla con la voz "${nombre}"` };
}

// ---------- conexión con el agente de ElevenLabs ----------
async function urlAgente() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de ElevenLabs.');
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(AGENT_ID())}`, { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`ElevenLabs rechazó la solicitud (HTTP ${r.status}).`);
  const j = await r.json();
  return j.signed_url;
}

// Sesión de conversación. Callbacks: onAudio(pcmMono, rate), onInterrupt(), onFin(), onEvento(msg).
async function abrirSesion({ onAudio, onInterrupt, onFin, onEvento }) {
  const ws = new WebSocket(await urlAgente());
  const s = { ws, listo: false, rateIn: 16000, rateOut: 16000, cola: [], cerrada: false, ultimaVoz: Date.now(), inicio: Date.now() };
  const enviar = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  s.enviar = enviar;
  s.texto = (t) => enviar({ type: 'user_message', text: t });
  s.audio = (pcm) => { if (!s.listo) { s.cola.push(pcm); if (s.cola.length > 100) s.cola.shift(); } else enviar({ user_audio_chunk: pcm.toString('base64') }); };
  s.cerrar = () => { if (s.cerrada) return; s.cerrada = true; try { ws.close(); } catch {} sumarSegundos((Date.now() - s.inicio) / 1000); onFin?.(); };
  ws.addEventListener('open', () => enviar({ type: 'conversation_initiation_client_data', dynamic_variables: { contexto_reciente: contextoReciente() } }));
  ws.addEventListener('close', () => s.cerrar());
  ws.addEventListener('error', (e) => { est.error = `ElevenLabs: ${e.message || 'error de conexión'}`; log('coordinador', est.error, 'warn'); s.cerrar(); });
  ws.addEventListener('message', async (ev) => {
    let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
    onEvento?.(m);
    if (m.type === 'conversation_initiation_metadata') {
      const e = m.conversation_initiation_metadata_event || {};
      s.rateIn = rateDe(e.user_input_audio_format); s.rateOut = rateDe(e.agent_output_audio_format);
      s.listo = true; s.rateListo?.(s);
      for (const c of s.cola.splice(0)) enviar({ user_audio_chunk: c.toString('base64') });
    } else if (m.type === 'ping') enviar({ type: 'pong', event_id: m.ping_event?.event_id });
    else if (m.type === 'audio') { if (m.audio_event?.audio_base_64) onAudio?.(Buffer.from(m.audio_event.audio_base_64, 'base64'), s.rateOut, m.audio_event.is_final); }
    else if (m.type === 'interruption') onInterrupt?.();
    else if (m.type === 'client_tool_call') {
      const c = m.client_tool_call || {};
      try { const r = await ejecutarHerramienta(c.tool_name, c.parameters, (t) => s.texto(t)); enviar({ type: 'client_tool_result', tool_call_id: c.tool_call_id, result: String(r), is_error: false }); }
      catch (e) { enviar({ type: 'client_tool_result', tool_call_id: c.tool_call_id, result: String(e.message), is_error: true }); }
    }
  });
  return s;
}

// Prueba sin Discord: conversa por texto con el agente y devuelve lo que dijo y qué herramientas usó.
export async function pruebaTexto(texto) {
  const eventos = []; let respondido; const fin = new Promise((r) => { respondido = r; });
  const s = await abrirSesion({
    onEvento: (m) => {
      if (m.type === 'agent_response') eventos.push({ agente: m.agent_response_event?.agent_response });
      else if (m.type === 'client_tool_call') eventos.push({ herramienta: m.client_tool_call?.tool_name, parametros: m.client_tool_call?.parameters });
      else if (m.type === 'agent_tool_response') eventos.push({ resultado_herramienta: m.agent_tool_response?.tool_name, estado: m.agent_tool_response?.status });
      else if (m.type === 'client_error') eventos.push({ error: m.error_event });
      else if (m.type === 'agent_response_complete') respondido();
    },
    onAudio: () => {},
  });
  s.rateListo = () => s.texto(String(texto).slice(0, 500));
  const t = setTimeout(() => respondido(), 40_000);
  await fin; clearTimeout(t);
  s.cerrar();
  return eventos;
}

// ---------- bot de Discord ----------
let client = null, conexion = null, reproductor = null, sesion = null, salida = null, finSalida = null, cierre = null;
// Lo que Diego dice mientras se abre la sesión (unos cientos de ms) se guarda y se manda apenas conecta.
let abriendo = false, previo = [];

function cortarSalida() { try { salida?.destroy(); } catch {} salida = null; clearTimeout(finSalida); try { reproductor?.stop(true); } catch {} }
function sonar(pcm, rate, esFinal, V) {
  if (!reproductor) return;
  if (!salida || salida.destroyed) { salida = new PassThrough(); reproductor.play(V.createAudioResource(salida, { inputType: V.StreamType.Raw })); }
  salida.write(subir(pcm, rate));
  clearTimeout(finSalida);
  if (esFinal) { salida.end(); salida = null; } else finSalida = setTimeout(() => { try { salida?.end(); } catch {} salida = null; }, 1500);
}

async function abrirSesionVoz(V) {
  if (sesion || abriendo || !conexion) return;
  if (minutosHoy() >= MAX_MIN_DIA) { log('coordinador', `Voz: tope diario de ${MAX_MIN_DIA} minutos alcanzado`, 'warn'); return; }
  est.sesion = true;
  abriendo = true; previo = [];
  try {
    sesion = await abrirSesion({
      onAudio: (pcm, rate, fin) => { if (sesion) sesion.ultimaVoz = Date.now(); sonar(pcm, rate, fin, V); },
      onInterrupt: () => cortarSalida(),
      onFin: () => { sesion = null; est.sesion = false; clearInterval(cierre); cortarSalida(); },
      onEvento: (m) => {
        if (m.type === 'user_transcript' || m.type === 'user_transcription_event') { if (sesion) sesion.ultimaVoz = Date.now(); anotarVoz('diego', m.user_transcription_event?.user_transcript); }
        else if (m.type === 'agent_response') anotarVoz('jarvis', m.agent_response_event?.agent_response);
      },
    });
    for (const pcm of previo.splice(0)) sesion.audio(bajar(pcm, sesion.rateIn));
    cierre = setInterval(() => { if (sesion && Date.now() - sesion.ultimaVoz > SILENCIO_CIERRE_MS) { log('coordinador', 'Voz: sesión cerrada por silencio', 'info'); sesion.cerrar(); } }, 5_000);
  } catch (e) { sesion = null; est.sesion = false; est.error = e.message; log('coordinador', `Voz: no se pudo abrir la sesión: ${e.message}`, 'error'); }
  finally { abriendo = false; previo = []; }
}

async function unirse(canal, V) {
  if (conexion) return;
  conexion = V.joinVoiceChannel({ channelId: canal.id, guildId: canal.guild.id, adapterCreator: canal.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  est.canal = canal.name;
  reproductor = V.createAudioPlayer({ behaviors: { noSubscriber: V.NoSubscriberBehavior.Play } });
  conexion.subscribe(reproductor);
  try { await V.entersState(conexion, V.VoiceConnectionStatus.Ready, 20_000); } catch (e) { log('coordinador', `Voz: no se pudo entrar al canal ${canal.name}: ${e.message}`, 'error'); salir(); return; }
  log('coordinador', `Voz: Jarvis entró al canal ${canal.name}`, 'ok');
  const prism = (await import('prism-media')).default;
  const rx = conexion.receiver;
  const op = rx.subscribe(OWNER(), { end: { behavior: V.EndBehaviorType.Manual } });
  const dec = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
  op.pipe(dec);
  let resto = Buffer.alloc(0);
  const tick = setInterval(() => {
    if (!sesion?.listo) return;
    const n = Math.round(sesion.rateIn * CHUNK_MS / 1000) * 2;
    sesion.audio(resto.length >= n ? resto.subarray(0, n) : Buffer.concat([resto, Buffer.alloc(n - resto.length)]));
    resto = resto.length >= n ? resto.subarray(n) : Buffer.alloc(0);
    if (resto.length > n * 20) resto = resto.subarray(resto.length - n * 5); // nunca acumular de más
  }, CHUNK_MS);
  rx.speaking.on('start', (id) => { if (id === OWNER()) { if (sesion) sesion.ultimaVoz = Date.now(); else abrirSesionVoz(V); } });
  dec.on('data', (pcm) => { if (sesion?.listo) resto = Buffer.concat([resto, bajar(pcm, sesion.rateIn)]); else if (sesion) sesion.audio(bajar(pcm, sesion.rateIn)); else if (abriendo && previo.length < 150) previo.push(pcm); });
  conexion.once(V.VoiceConnectionStatus.Destroyed, () => clearInterval(tick));
  conexion.on('stateChange', (_, n) => { if (n.status === V.VoiceConnectionStatus.Disconnected) V.entersState(conexion, V.VoiceConnectionStatus.Connecting, 5000).catch(() => salir()); });
}
function salir() {
  try { sesion?.cerrar(); } catch {}
  try { conexion?.destroy(); } catch {}
  conexion = null; reproductor = null; est.canal = null;
}

export async function iniciarVoz() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return;
  if (client) { try { await client.destroy(); } catch {} client = null; salir(); }
  try {
    const { Client, GatewayIntentBits } = await import('discord.js');
    const V = await import('@discordjs/voice');
    client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    client.once('clientReady', async () => {
      est.listo = true; est.tag = client.user.tag; est.error = null;
      log('coordinador', `Voz: bot de Discord conectado como ${client.user.tag}`, 'ok');
      for (const g of client.guilds.cache.values()) { const vs = g.voiceStates.cache.get(OWNER()); if (vs?.channel?.id === CANAL()) await unirse(vs.channel, V); }
    });
    client.on('voiceStateUpdate', async (antes, ahora) => {
      if (ahora.id !== OWNER()) return;
      // Solo en el canal elegido: si Diego está en otro (o sale), Jarvis no entra o se va.
      if (ahora.channel?.id === CANAL()) { if (!conexion || conexion.joinConfig.channelId !== ahora.channelId) { if (conexion) salir(); await unirse(ahora.channel, V); } }
      else if (conexion) { log('coordinador', 'Voz: Diego salió del canal de Jarvis; Jarvis también', 'info'); salir(); return; }
      else if (!ahora.channel) { log('coordinador', 'Voz: Diego salió del canal; Jarvis también', 'info'); salir(); }
    });
    client.on('error', (e) => { est.error = e.message; });
    await client.login(token);
  } catch (e) { est.listo = false; est.error = e.message; log('coordinador', `Voz: no se pudo iniciar el bot de Discord: ${e.message}`, 'error'); }
}

// Discord corta en 2000 caracteres: se parte entre párrafos (o líneas, o palabras), nunca a mitad de palabra,
// y un bloque de código que queda abierto se cierra y se vuelve a abrir en el siguiente mensaje.
export function partirDiscord(t, max = 1900) {
  const partes = [];
  let resto = String(t).trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n\n', max);
    if (corte < max * 0.4) corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.4) corte = resto.lastIndexOf(' ', max);
    if (corte < 1) corte = max;
    let parte = resto.slice(0, corte).trimEnd();
    resto = resto.slice(corte).trimStart();
    if ((parte.match(/```/g) || []).length % 2) { parte += '\n```'; resto = '```\n' + resto; }
    partes.push(parte);
  }
  if (resto) partes.push(resto);
  return partes;
}

// Mensaje privado de Jarvis a Diego por Discord (lo usa la herramienta discord_a_diego).
export async function mensajeDiscord(texto) {
  if (!client || !est.listo) throw new Error('El bot de Discord no está conectado.');
  const u = await client.users.fetch(OWNER());
  for (const parte of partirDiscord(String(texto).slice(0, 8000))) await u.send(parte);
  return true;
}

// Un archivo por mensaje privado a Diego (el respaldo diario de la base de Cresova). Discord acepta hasta 10 MB.
export async function archivoDiscord(nombre, contenido, texto = '') {
  if (!client || !est.listo) throw new Error('El bot de Discord no está conectado.');
  if (contenido.length > 9.5e6) throw new Error('El archivo pasa de 10 MB.');
  const u = await client.users.fetch(OWNER());
  await u.send({ content: String(texto).slice(0, 1900) || undefined, files: [{ attachment: contenido, name: nombre }] });
  return true;
}
