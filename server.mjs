// Servidor de la oficina: sirve la vista, transmite eventos por SSE,
// recibe aprobaciones y dispara a cada agente según su horario.
import { spawn as spawnPoster } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { publicKeys, setKey, testKey, saldoOpenRouter } from './secrets.mjs';
import { TIMEZONE, DEPARTMENTS } from './agents.mjs';
import { getAgents, getAgent, isPaused, publicSettings, setPaused, updateAgent, saveText, resetText, restoreText } from './settings.mjs';
import { permitir, addClient, publicState, resolveApproval, readDeliverable, reviewDeliverable, log, state, DATA_DIR, listDeliverables, saveNow } from './state.mjs';
import { runAgent, chatAgent, stopAgent, isRunning, groupReply } from './runner.mjs';
import { connectionStatus, claudeCredential } from './connections.mjs';
import { receiveUpload, listVideos, listJobs, startRender, renderFile, videoReviews, priorizarRender, cancelarRender } from './estudio.mjs';
import { createTask, updateTask, onReview, startTaskWorker } from './tareas.mjs';
import * as dev from './desarrollo/proyectos.mjs';
import * as cdb from './cresova/db.mjs';
import { startCupoWatcher, isBlocked, queueRetry, publicCupo, unblock, isAhorro, setAhorro, setLimites } from './cupo.mjs';
import { iniciarVoz, vozStatus, pruebaTexto, aplicarVoz } from './voz.mjs';
import { startLinea, publicLinea, setLinea, removeQueued, enqueueChange } from './linea.mjs';
import * as ventas from './ventas/vendedor.mjs';
import { listMemoria, forget as forgetMemoria, remember } from './memoria.mjs';
import * as wa from './ventas/whatsapp.mjs';
import './cresova/renovaciones.mjs'; // vencimientos de hosting y dominio
import './cresova/posventa.mjs'; // reseña + referido después de entregar (apagado hasta que Diego apruebe)
import './cresova/cobranza.mjs'; // recordatorios de pago (apagados hasta que Diego confirme)
import { etapaNombre } from './ventas/etapa.mjs';
import './cresova/ceo.mjs'; // dueño de la meta: marcador diario y registro de cambios
import './ventas/calidad.mjs'; // vigila la calidad del número de ventas (Meta) y cuenta las plantillas
import * as prosp from './prospeccion/index.mjs';
import * as reuniones from './reuniones.mjs';
import { tipoVideo } from './enlaces.mjs';
import { publishVideo, cancelPublish, postText, nextSlot, hnLabel, auditCalendar, calendarState } from './publicador.mjs';
import { postGroup, groupBusy, isDept } from './grupo.mjs';
import { runDemoAgent, chatDemoAgent, runDemoDay, isDemoRunning, demoGroupReply } from './demo.mjs';

const PORT = Number(process.env.PORT || 3000);
// Contraseña de la oficina: la exige la oficina misma (no EasyPanel), así las demos pueden ser públicas.
const PASS_FILE = path.join(DATA_DIR, '.office-password');
// (El archivo de clave solo se usaría si EasyPanel dejara de pedir la contraseña: Traefik no le pasa la clave a la oficina.)
let PASSWORD = process.env.OFFICE_PASSWORD || '';
if (fs.existsSync(PASS_FILE)) fs.rmSync(PASS_FILE, { force: true });
const DEMO = process.env.DEMO_MODE === '1' || !(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
const PUBLIC_DIR = path.join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

// El vendedor no es un agente de Claude: se prueba en la pestaña Ventas.
// Un error suelto en una tarea de fondo no debe tumbar la oficina (antes un rechazo sin manejar la reiniciaba y el navegador veía 502).
for (const ev of ['unhandledRejection', 'uncaughtException']) process.on(ev, (e) => { console.error(ev, e); try { log(null, `Error no controlado (${ev}): ${String(e?.message || e).slice(0, 200)}`, 'error'); } catch {} });
const run = (id, opts) => (!getAgent(id) ? Promise.resolve(false) : getAgent(id)?.engine ? Promise.resolve(false) : DEMO ? runDemoAgent(id, opts) : runAgent(id, opts));
startCupoWatcher({ run, busy: (id) => busy(id) });
startLinea({ run, busy: (id) => busy(id) });
const busy = (id) => (DEMO ? isDemoRunning(id) : isRunning(id));

// Todos a trabajar, en el orden en que se pasan el trabajo (cada uno lee al anterior).
let chainRunning = false;
async function runChain() {
  chainRunning = true;
  try {
    run('media', { reason: 'equipo completo' });
    for (const id of ['estratega', 'guionista', 'video', 'community']) {
      while (busy(id)) await new Promise((r) => setTimeout(r, 2000));
      await run(id, { reason: 'equipo completo' });
    }
  } finally {
    chainRunning = false;
  }
}

function authorized(req) {
  if (!PASSWORD) return true;
  const [scheme, value] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !value) return false;
  const given = Buffer.from(Buffer.from(value, 'base64').toString().split(':').slice(1).join(':'));
  const expected = Buffer.from(PASSWORD);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req, max = 1e5) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > max) throw new Error('Cuerpo demasiado grande');
  }
  return body ? JSON.parse(body) : {};
}

function send(res, code, data, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  // Gastos desde n8n (mismo JSON que /api/public/expenses de cresova.com), con su propia llave en x-api-key.
  // EasyPanel pide usuario y contraseña en el dominio de la oficina; desde afuera se entra por el dominio público
  // de las demos: https://demo.preview.cresova.com/hook/gastos.
  if (url.pathname === '/hook/gastos' && req.method === 'POST') {
    const ok = (await import('./cresova/gastos.mjs')).llaveValida(req.headers['x-api-key']);
    if (ok === null) return send(res, 503, { ok: false, error: 'Integración no configurada' });
    if (!ok) return send(res, 401, { ok: false, error: 'API key inválida' });
    if (!cdb.configurado()) return send(res, 503, { ok: false, error: 'La base de Cresova no está conectada' });
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { ok: false, error: 'El cuerpo debe ser JSON' }); }
    try { const r = await (await import('./cresova/gastos.mjs')).registrar(body); return send(res, r.status, r.body); }
    catch (e) { log(null, `Gasto desde n8n no guardado: ${e.message}`, 'error'); return send(res, 500, { ok: false, error: 'No se pudo guardar el gasto' }); }
  }
  // Vistas previas de Desarrollo: públicas (son las que se le mandan al cliente).
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (host === dev.PREVIEW_HOST) {
    // ¿El cliente abrió su demo? Solo la página principal y sin robots (la vista previa de WhatsApp, buscadores) ni
    // las revisiones de Ashley/Luis (navegador automatizado).
    const pm = req.method === 'GET' && url.pathname.match(/^\/([a-z0-9-]+)\/?$/);
    const ua = String(req.headers['user-agent'] || '');
    if (pm && !/bot|crawl|spider|facebookexternalhit|WhatsApp|Headless|Playwright|curl|python|node/i.test(ua)) wa.vistaDemo(pm[1]);
    if (req.method === 'GET' && dev.servirPreview(req, res, url.pathname)) return;
    return send(res, 404, 'No encontrado', 'text/plain');
  }
  if (req.method === 'GET' && url.pathname.startsWith('/p/') && dev.servirPreview(req, res, url.pathname.slice(2))) return;
  // Enlace público temporal a un video aprobado (para que Meta lo baje al subirlo a pauta). Llega por el proxy de las demos.
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/publico/video/')) {
    const { servirEnlace } = await import('./enlaces.mjs');
    return servirEnlace(req, res, url.pathname.split('/')[3] || '');
  }
  // Webhook de Evolution (WhatsApp): sin usuario y contraseña, protegido por un token en la ruta.
  if (req.method === 'POST' && url.pathname.startsWith('/hook/evolution/')) {
    if (url.pathname.split('/').pop() !== wa.hookToken()) return send(res, 404, 'No encontrado', 'text/plain');
    let body;
    try { body = await readJson(req, 25e6); } catch { return send(res, 400, { ok: false }); }
    send(res, 200, { ok: true });
    wa.handleWebhook(body).catch((e) => log('vendedor', `Webhook de WhatsApp: ${e.message}`, 'error'));
    return;
  }
  // WhatsApp de ventas por la API oficial (YCloud): llega por la puerta pública (proxy de las demos).
  if (req.method === 'POST' && url.pathname.startsWith('/hook/ycloud/')) {
    const yc = await import('./ventas/ycloud.mjs');
    if (url.pathname.split('/').pop() !== yc.hookToken()) return send(res, 404, 'No encontrado', 'text/plain');
    const partes = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 25e6) return send(res, 413, { ok: false }); partes.push(c); }
    const raw = Buffer.concat(partes).toString('utf8');
    if (!yc.verificarFirma(raw, req.headers['ycloud-signature'])) { log('vendedor', 'Webhook de YCloud con firma inválida: ignorado', 'warn'); return send(res, 401, { ok: false }); }
    send(res, 200, { ok: true });
    let ev; try { ev = JSON.parse(raw); } catch { return; }
    (async () => { for (const rec of yc.recibir(ev)) await wa.handleWebhook({ event: 'messages.upsert', data: rec }); })().catch((e) => log('vendedor', `Webhook de YCloud: ${e.message}`, 'error'));
    return;
  }
  // Webhook del número de prospección (otra instancia de Evolution): las respuestas las atiende el vendedor.
  if (req.method === 'POST' && url.pathname.startsWith('/hook/evolution-p/')) {
    if (url.pathname.split('/').pop() !== wa.hookTokenProspeccion()) return send(res, 404, 'No encontrado', 'text/plain');
    let body;
    try { body = await readJson(req, 25e6); } catch { return send(res, 400, { ok: false }); }
    send(res, 200, { ok: true });
    const inst = String(body?.instance || '').trim() || 'cresova-prospeccion';
    wa.handleWebhook(body, { inst }).catch((e) => log('gerente_ventas', `Webhook de prospección: ${e.message}`, 'error'));
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Oficina Cresova"' });
    return res.end('Acceso restringido');
  }

  try {
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      return addClient(res);
    }
    if (url.pathname === '/api/config') {
      return send(res, 200, { demo: DEMO, timezone: TIMEZONE, agents: getAgents(), departments: DEPARTMENTS, paused: isPaused() });
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return send(res, 200, publicSettings());
    }
    if (url.pathname === '/api/state') return send(res, 200, publicState());
    if (url.pathname === '/api/keys' && req.method === 'GET') return send(res, 200, publicKeys());
    if (url.pathname === '/api/keys' && req.method === 'POST') {
      const { env, value } = await readJson(req);
      try { setKey(env, value); } catch (e) { return send(res, 400, { error: e.message }); }
      if (env === 'DATABASE_URL') cdb.reiniciar();
      log(null, value ? 'Llave guardada desde Sistema' : 'Llave quitada desde Sistema', 'system');
      // Llave de Meta nueva: se prueba ya (si no, el error viejo queda a la vista hasta el envío de cada hora).
      if (/^META(ADS|_CAPI)_TOKEN$/.test(env) && value) import('./cresova/meta-mensajeria.mjs').then((mm) => mm.barrer()).catch(() => {});
      if (env === 'EVOLUTION_INSTANCE' && value && /^[0-9a-f-]{30,}$/i.test(value)) log('vendedor', 'Ojo: en "instancia" va el NOMBRE de la instancia de Evolution (por ejemplo cresova), no su token.', 'warn');
      await connectionStatus({ force: true });
      // Con la llave de Claude recién puesta, la oficina sale del modo demo reiniciándose.
      const restart = env === 'CLAUDE_CODE_OAUTH_TOKEN' && process.env.DEMO_MODE !== '1' && DEMO === Boolean(value);
      send(res, 200, { ok: true, keys: publicKeys(), restart });
      if (['DISCORD_BOT_TOKEN', 'DISCORD_OWNER_ID', 'ELEVENLABS_AGENT_ID', 'ELEVENLABS_API_KEY'].includes(env) && process.env.DISCORD_BOT_TOKEN) iniciarVoz().catch(() => {});
      if (env === 'ELEVENLABS_VOICE_ID' && value) aplicarVoz().then((r) => r.state !== 'ok' && log('coordinador', `No se pudo poner la voz de Jarvis: ${r.detail || r.state}`, 'warn')).catch(() => {});
      if (restart) setTimeout(() => process.exit(0), 600);
      return;
    }
    if (url.pathname === '/api/voz' && req.method === 'GET') return send(res, 200, vozStatus());
    const mCeo = req.method === 'POST' ? url.pathname.match(/^\/api\/ceo\/cambios\/([\w-]+)\/revertir$/) : null; if (mCeo) { try { return send(res, 200, (await import('./cresova/ceo.mjs')).revertirCambio({ id: mCeo[1], motivo: 'Diego lo pidió desde su pantalla', por: 'Diego' })); } catch (e) { return send(res, 400, { error: e.message }); } }
    const mApr = req.method === 'POST' ? url.pathname.match(/^\/api\/ceo\/aprendizajes\/([\w-]+)\/quitar$/) : null;
    if (mApr) return send(res, 200, { ok: (await import('./memoria.mjs')).quitarAprendizaje(mApr[1]) });
    if (url.pathname === '/api/ceo/encargo' && req.method === 'POST') { const b = await readJson(req); return send(res, 200, (await import('./cresova/ceo.mjs')).agregarEncargo(b.texto)); }
    if (url.pathname === '/api/ceo' && req.method === 'GET') return send(res, 200, await (await import('./cresova/ceo.mjs')).panel());
    if (url.pathname === '/api/voz/gasto' && req.method === 'GET') { try { return send(res, 200, await (await import('./voz.mjs')).gastoVoz({ forzar: url.searchParams.has('forzar') })); } catch (e) { return send(res, 502, { error: e.message }); } }
    if (url.pathname === '/api/recontacto' && req.method === 'GET') return send(res, 200, (await import('./ventas/recontacto.mjs')).estadoRecontacto());
    if (url.pathname === '/api/voz/prueba' && req.method === 'POST') {
      const { texto } = await readJson(req);
      try { return send(res, 200, { eventos: await pruebaTexto(typeof texto === 'string' && texto.trim() ? texto : 'Hola, ¿cómo va todo en la oficina?') }); }
      catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (url.pathname === '/api/keys/test' && req.method === 'POST') {
      const { env } = await readJson(req);
      const MCP = { CRESOVA_MCP_API_KEY: 'cresova', UPLOADPOST_API_KEY: 'uploadpost', METAADS_TOKEN: 'metaads' };
      let result = env === 'ELEVENLABS_VOICE_ID' ? await aplicarVoz().catch((e) => ({ state: 'unreachable', detail: e.message })) : await testKey(env);
      if (!result && MCP[env]) result = (await connectionStatus({ force: true })).find((c) => c.id === MCP[env]) || { state: 'missing' };
      return send(res, 200, result || { state: process.env[env] ? 'saved' : 'missing' });
    }
    if (url.pathname === '/api/status') {
      const estudio = {
        videos: listVideos().length,
        skill: fs.existsSync(path.join(DATA_DIR, 'plugins', 'motion-video-director', '.claude-plugin', 'plugin.json')),
        elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
      };
      return send(res, 200, { demo: DEMO, cupo: publicCupo(), claude: claudeCredential(), connections: await connectionStatus({ force: url.searchParams.has('refresh') }), estudio });
    }
    if (req.method === 'POST' && url.pathname === '/api/run-all') {
      if (isPaused()) return send(res, 409, { error: 'La pausa general está activa. Quitala en Ajustes para poner a trabajar al equipo.' });
      if (chainRunning) return send(res, 409, { error: 'El equipo ya está trabajando en cadena.' });
      runChain();
      return send(res, 202, { ok: true });
    }

    let m;
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/run\/(\w+)$/))) {
      if (!getAgent(m[1])) return send(res, 404, { error: 'Agente desconocido' });
      if (!getAgent(m[1]).enabled) return send(res, 409, { error: 'Este agente está apagado. Encendelo en Ajustes.' });
      if (busy(m[1])) return send(res, 409, { error: 'Ya está trabajando' });
      const { instruction } = await readJson(req);
      const encargo = typeof instruction === 'string' && instruction.trim() ? instruction.trim().slice(0, 4000) : undefined;
      run(m[1], { reason: encargo ? 'encargo de Diego' : 'manual', instruction: encargo });
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/chat\/(\w+)$/))) {
      if (!getAgent(m[1])) return send(res, 404, { error: 'Agente desconocido' });
      if (!getAgent(m[1]).enabled) return send(res, 409, { error: 'Este agente está apagado. Encendelo en Ajustes.' });
      const { message } = await readJson(req);
      const text = typeof message === 'string' ? message.trim().slice(0, 4000) : '';
      if (!text) return send(res, 400, { error: 'Mensaje vacío' });
      if (busy(m[1])) return send(res, 409, { error: 'Está ocupada con otra tarea. Esperá a que termine.' });
      if (getAgent(m[1]).engine) return send(res, 400, { error: 'Al vendedor se le escribe como cliente en la pestaña Ventas.' });
      (DEMO ? chatDemoAgent : chatAgent)(m[1], text);
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/deliverables\/([\w-]+)\/review$/))) {
      try {
      const { status, note, rerun, answer, veto, cuando, por } = await readJson(req);
      const quien = por === 'CEO' ? 'El CEO' : 'Diego';
      const text = typeof note === 'string' ? note.slice(0, 2000) : '';
      const d = reviewDeliverable(m[1], status, text, typeof answer === 'string' ? answer : '');
      if (!d) return send(res, 404, { error: 'Entregable no encontrado o estado inválido' });
      if (d.kind === 'informe') { if (d.taskId && status === 'read') onReview(d, 'read', ''); return send(res, 200, d); }
      // Video tipo anuncio aprobado: no va al calendario orgánico de Andrés; se le encarga a Renata subirlo a Meta.
      if (d.kind === 'video' && status === 'approved' && tipoVideo(d) === 'anuncio') {
        const dv = state.deliverables.find((x) => x.id === d.id);
        if (dv && !dv.avisoRenata) {
          dv.avisoRenata = Date.now(); dv.tipo = 'anuncio'; saveNow();
          try {
            createTask({ assignee: 'media', priority: 'alta', createdBy: 'diego', title: `Subir anuncio a Meta: ${d.title.replace(/^[^\w¿¡]+/, '').replace(/^Anuncio\s*·\s*/i, '')}`.slice(0, 140),
              description: `Diego aprobó este video como ANUNCIO (entregable ${d.id.slice(0, 8)}). No se publica orgánico.
1) anuncio_video_enlace con ese id para sacar el enlace público temporal.
2) Subilo a la cuenta de Meta de Cresova (ads_creative_upload_media, media_type VIDEO, upload_source URL).
3) Armá el anuncio en PAUSA dentro de la campaña que corresponda según la metodología (sin activarlo ni tocar presupuesto: eso lo aprueba Diego).
4) anuncio_video_registrar con el id del video y del anuncio en Meta, para medir costo por lead y por demo.
5) Entregale a Diego un resumen corto: dónde quedó, en pausa, y qué falta para activarlo.` });
          } catch (e) { log('media', `No se pudo crear la tarea del anuncio: ${e.message}`, 'warn'); }
        }
      }
      // Video orgánico aprobado: se programa solo en TikTok y YouTube (Diego, 10 nov).
      if (d.kind === 'video' && status === 'approved' && tipoVideo(d) !== 'anuncio') (await import('./publicador.mjs')).autoPublicar(d.id).catch((e) => log('community', `No se pudo programar solo: ${e.message}`, 'warn'));
      // "No, cerrar el tema": queda como tema vetado y ningún agente lo vuelve a proponer.
      if (status === 'discarded' && veto) {
        state.vetos ||= [];
        state.vetos.push({ ts: Date.now(), agentId: d.agentId, tema: `${d.title}${d.question ? ` (${d.question})` : ''}`.slice(0, 300), motivo: text });
        if (state.vetos.length > 60) state.vetos.splice(0, state.vetos.length - 60);
      }
      if (d.ventasConv && /reactivar/i.test(d.answer || '')) { try { wa.resume(d.ventasConv); } catch {} }
      if (d.devProyecto && status === 'approved') {
        if (/^s[ií]/i.test(d.answer || 'sí')) dev.enviarDemo(d.devProyecto, { cuando: Number(cuando) || null }).catch((e) => log('constructor', `No se pudo enviar la demo: ${e.message}`, 'error'));
        else if (text) dev.pedir(d.devProyecto, text).catch((e) => { log('constructor', `No se pudo pasar el pedido a Píxel: ${e.message}`, 'error'); wa.avisarDiego(`⚠️ Tu pedido para Píxel (${d.devProyecto}) no salió: ${e.message}`).catch(() => {}); });
      }
      if (d.devProyecto && status === 'changes' && text) dev.pedir(d.devProyecto, text).catch((e) => { log('constructor', `No se pudo pasar el pedido a Píxel: ${e.message}`, 'error'); wa.avisarDiego(`⚠️ Tu pedido para Píxel (${d.devProyecto}) no salió: ${e.message}`).catch(() => {}); });
      if (d.prospeccionPropuesta && status === 'approved' && /^s[ií]/i.test(d.answer || '')) prosp.aprobarPropuesta(d.prospeccionPropuesta, d.answer).catch((e) => log('prospector', `No se pudo crear la campaña: ${e.message}`, 'error'));
      if (d.prospeccionPropuesta && status === 'discarded') prosp.propuestaCerrada();
      if (d.prospeccionLote && status === 'approved' && /^s[ií]/i.test(d.answer || 'sí')) prosp.aprobarLote(d.prospeccionLote).catch((e) => log('gerente_ventas', `No se pudo aprobar la prospección: ${e.message}`, 'error'));
      if (d.recontactoLote && status === 'approved' && /^s[ií]/i.test(d.answer || 'sí')) import('./ventas/recontacto.mjs').then((rc) => rc.aprobarLote(d.recontactoLote)).catch((e) => log('vendedor', `No se pudo aprobar el recontacto: ${e.message}`, 'error'));
      // Diego eligió qué guiones de Mateo producir: pasan a Nico con su elección (antes se cerraba la tarea y nada más).
      if (d.agentId === 'guionista' && d.kind === 'decision' && status === 'approved' && !/^(no\b|ninguno|descart)/i.test(d.answer || '')) {
        import('./linea.mjs').then(async (ln) => {
          if (!ln.sonGuiones(d.title, readDeliverable(d.id))) return;
          const t = await ln.guionesANico(d, { tareaOrigen: d.taskId ? state.tasks.find((x) => x.id === d.taskId) : null, eleccion: `${d.answer || 'Sí'}${text ? ` — ${text}` : ''}` });
          log('guionista', `Diego eligió «${d.answer || 'Sí'}»: los guiones pasaron a Nico (${t.title})`, 'ok');
        }).catch((e) => log('guionista', `No se pudieron pasar los guiones a Nico: ${e.message}`, 'error'));
      }
      if (d.pagoAnticipo && status === 'approved') wa.confirmarAnticipo(d.pagoAnticipo, /^s[ií]/i.test(d.answer || 'sí')).catch((e) => { log('vendedor', `No se pudo registrar el anticipo: ${e.message}`, 'error'); wa.avisarDiego(`⚠️ No pude registrar el anticipo: ${e.message}. Registralo a mano en Cotizaciones.`).catch(() => {}); });
      if (d.ventasPregunta && status === 'approved') wa.relayAnswer(d.ventasConv, d.answer || text).catch((e) => log('vendedor', `No se pudo mandar la respuesta: ${e.message}`, 'error'));
      // Diego respondió una pregunta: el agente que la hizo sigue enseguida con esa respuesta.
      if (d.kind === 'decision' && status === 'approved' && !d.taskId && !d.ventasConv && !d.recontactoLote && !d.prospeccionLote && !(d.prospeccionPropuesta && /^s[ií]/i.test(d.answer || '')) && !d.devProyecto && getAgent(d.agentId)) {
        const instruction = `${quien} respondió a tu pregunta "${d.question || d.title}": **${d.answer || 'Sí, aprobado'}**${text ? ` — nota: ${text}` : ''}. Hacé lo que corresponde con esa respuesta ahora y entregá el resultado.`;
        if (getAgent(d.agentId)?.studio) enqueueChange({ title: `Respuesta de Diego: ${d.title}`, sourceId: d.id, instruction });
        else if (!busy(d.agentId)) run(d.agentId, { reason: 'respuesta de Diego', instruction });
        else queueRetry({ agentId: d.agentId, reason: 'respuesta de Diego', instruction });
      }
      const verb = d.answer ? `respondió «${d.answer}» a`
        : status === 'approved' ? (d.kind === 'video' ? 'aprobó para publicar' : 'aprobó')
        : status === 'discarded' ? 'descartó' : 'pidió cambios en';
      log(d.agentId, `${quien} ${verb}: ${d.title}${text ? ` — ${text.slice(0, 120)}` : ''}`, status === 'changes' || status === 'discarded' ? 'warn' : 'ok');
      // Si es de una tarea del tablero, la tarjeta se mueve sola y el trabajador la reasigna.
      if (d.taskId && onReview(d, status, text)) return send(res, 200, d);
      // Cambios a un video: van a la cola con prioridad de Lucía (antes se perdían si estaba ocupada).
      if (status === 'changes' && d.kind === 'video') {
        enqueueChange({ title: d.title, sourceId: d.id, instruction: `Diego pidió cambios en el video videos/${d.video.video} ("${d.title.replace(/^(🎬\s*)+/, '')}"):

${text}

Trabajá en esa misma carpeta, corregí TODO lo pedido (revisá punto por punto), revisá el tramo con una vista previa y encargá un render nuevo. En tu resumen, contá qué hiciste con cada punto.` });
        return send(res, 200, d);
      }
      if (status === 'changes' && rerun && !busy(d.agentId)) {
        const instruction = d.kind === 'video'
          ? `Diego pidió cambios en el video videos/${d.video.video} ("${d.title}"): ${text}. Trabajá en esa misma carpeta, corregí solo lo pedido, revisá el tramo con una vista previa y encargá un render nuevo.`
          : `Diego pidió cambios en "${d.title}"${text ? `: ${text}` : ''}. Corregilo y volvé a entregar.`;
        run(d.agentId, { reason: 'cambios pedidos', instruction });
      } else if (status === 'changes' && d.kind !== 'video') {
        // Ocupado: los cambios quedan en cola y los hace apenas se libere (antes se perdían).
        queueRetry({ agentId: d.agentId, reason: 'cambios pedidos', instruction: `Diego pidió cambios en "${d.title}"${text ? `: ${text}` : ''}. Corregilo y volvé a entregar.` });
      }
      return send(res, 200, d);
      } catch (e) {
        log(null, `Error al guardar la respuesta de Diego (${m[1].slice(0, 8)}): ${e.message}`, 'error');
        return send(res, 500, { error: e.message });
      }
    }
    if (url.pathname === '/api/estudio/videos') return send(res, 200, videoReviews().map((v) => ({ ...v, post: v.published || postText(v.folder) })));
    if (url.pathname.startsWith('/api/ventas')) {
      const p = url.pathname.slice('/api/ventas'.length);
      try {
        if (req.method === 'GET' && p === '') return send(res, 200, ventas.ventasSummary());
        if (req.method === 'GET' && p === '/modelos') return send(res, 200, await ventas.listModels());
        // Prueba de transcripción con la voz de un video ya hecho (no toca WhatsApp).
        if (req.method === 'POST' && p === '/probar-audio') {
          const v = listDeliverables().filter((d) => d.kind === 'video').map((d) => renderFile(d.video.video, d.video.name)).find(Boolean);
          if (!v) return send(res, 404, { error: 'No hay videos renderizados para probar.' });
          const t0 = Date.now();
          const text = await wa.transcribeRaw(fs.readFileSync(v), 'video/mp4');
          return send(res, 200, { archivo: path.basename(v), texto: text, segundos: Math.round((Date.now() - t0) / 1000) });
        }
        if (req.method === 'GET' && p === '/whatsapp') return send(res, 200, await wa.waStatus());
        if (req.method === 'POST' && p === '/whatsapp/qr') return send(res, 200, await wa.qrWhatsapp());
        if (req.method === 'GET' && p === '/embudo/entrada') return send(res, 200, await (await import('./ventas/etapa.mjs')).embudoEntrada({ dias: Number(url.searchParams.get('dias')) || 30, fuente: url.searchParams.get('fuente') || 'todas' }));
        if (req.method === 'GET' && p === '/embudo') return send(res, 200, (await import('./ventas/etapa.mjs')).resumenEmbudo(Number(url.searchParams.get('dias')) || 30));
        if (req.method === 'POST' && p === '/embudo/reclasificar') return send(res, 200, await (await import('./ventas/etapa.mjs')).reclasificar());
        if (req.method === 'GET' && p === '/llamadas') return send(res, 200, await (await import('./ventas/llamadas.mjs')).lista());
        if (req.method === 'GET' && p === '/compromisos') return send(res, 200, (await import('./ventas/compromisos.mjs')).abiertos());
        if (req.method === 'POST' && p === '/compromisos/seguir') { const b = await readJson(req).catch(() => ({})); return send(res, 200, await (await import('./ventas/compromisos.mjs')).seguirCompromisos({ seco: b.seco !== false })); }
        if (req.method === 'POST' && p === '/compromisos/auto') { const b = await readJson(req).catch(() => ({})); return send(res, 200, (await import('./ventas/compromisos.mjs')).configurarAuto(b.activo !== false)); }
        if (req.method === 'POST' && p === '/compromisos/cargar') { const b = await readJson(req).catch(() => ({})); return send(res, 200, await (await import('./ventas/compromisos.mjs')).cargaInicial({ dias: Number(b.dias) || 30, seco: b.seco !== false })); }
        if (req.method === 'POST' && p === '/llamadas/resolver') { const b = await readJson(req); return send(res, 200, (await import('./ventas/llamadas.mjs')).resolver(b.key, b.resultado, b.nota || '')); }
        if (req.method === 'GET' && p === '/calidad') { const c = await import('./ventas/calidad.mjs'); return send(res, 200, { ultimo: ventas.ventasState.calidad?.ultimo || null, plantillas: c.conteo(Number(url.searchParams.get('dias')) || 14) }); }
        if (req.method === 'POST' && p === '/calidad/revisar') return send(res, 200, await (await import('./ventas/calidad.mjs')).revisar({ forzarResumen: true }));
        if (req.method === 'GET' && p === '/ycloud') return send(res, 200, await (await import('./ventas/ycloud.mjs')).estado());
        if (req.method === 'POST' && p === '/ycloud/conectar') return send(res, 200, await (await import('./ventas/ycloud.mjs')).conectar(await readJson(req).catch(() => ({}))));
        if (req.method === 'GET' && p === '/ycloud/plantillas') return send(res, 200, await (await import('./ventas/ycloud.mjs')).plantillas(url.searchParams.has('forzar')));
        if (req.method === 'POST' && p === '/ycloud/plantillas') return send(res, 200, await (await import('./ventas/ycloud.mjs')).crearPlantillas());
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/plantilla$/))) return send(res, 200, await wa.mandarPlantilla(m[1], (await readJson(req)).name));
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/postdemo$/))) return send(res, 200, wa.iniciarPostDemo(m[1]));
        if (req.method === 'POST' && p === '/ycloud/apagar') return send(res, 200, (await import('./ventas/ycloud.mjs')).apagar());
        if (req.method === 'POST' && p === '/whatsapp/recuperar') { const b = await readJson(req).catch(() => ({})); return send(res, 200, await wa.recuperarPerdidos(Date.now() - Math.min(72, Math.max(1, Number(b.horas) || 6)) * 3600e3)); }
        if (req.method === 'POST' && p === '/whatsapp/envios') { const b = await readJson(req); return send(res, 200, await wa.estadoEnvios(b.telefono, Number(b.n) || 12)); }
        if (req.method === 'POST' && p === '/whatsapp/crudo') { const b = await readJson(req); return send(res, 200, await wa.mensajeCrudo(b.telefono)); }
        if (req.method === 'POST' && p === '/whatsapp/historial/importar') { const b = await readJson(req).catch(() => ({})); return send(res, 200, await wa.importarHistorialRecontactos({ forzar: Boolean(b?.forzar) })); }
        if (req.method === 'POST' && p === '/whatsapp/historial') { const b = await readJson(req); return send(res, 200, await wa.diagnosticoHistorial(Array.isArray(b.telefonos) ? b.telefonos.slice(0, 8) : [])); }
        if (req.method === 'POST' && p === '/whatsapp/existentes') { const b = await readJson(req, 2e6); return send(res, 200, wa.addExisting(b.phones, b.fuente || 'lista')); }
        if (req.method === 'POST' && p === '/whatsapp/existentes/telefono') return send(res, 200, await wa.importExistingFromEvolution());
        if (req.method === 'POST' && p === '/whatsapp/auto') { const b = await readJson(req); return send(res, 200, { autoStart: wa.setAutoStart(b.on) }); }
        // Evolution vive en el mismo proyecto de EasyPanel: se le habla por la red interna (la URL pública tiene la contraseña de EasyPanel).
        if (req.method === 'POST' && p === '/whatsapp/conectar') return send(res, 200, await wa.connectWebhook(process.env.OFFICE_INTERNAL_URL || `http://tools_oficina:${process.env.PORT || 3000}`));
        if (req.method === 'POST' && p === '/whatsapp/vivo') { const b = await readJson(req); return send(res, 200, { live: await wa.setLive(b.on) }); }
        if (p === '/agenda' && req.method === 'GET') return send(res, 200, wa.agendaPendiente());
        if (p === '/pendientes' && req.method === 'GET') return send(res, 200, wa.promesasPendientes());
        if (p === '/agenda' && req.method === 'POST') {
          const b = await readJson(req);
          const conv = ventas.ventasState.convs[b.conv];
          if (!conv || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') || !b.motivo) return send(res, 400, { error: 'Falta conv, fecha (AAAA-MM-DD) o motivo.' });
          (conv.agenda ||= []).push({ id: randomUUID(), at: Date.parse(`${b.fecha}T15:00:00Z`), motivo: String(b.motivo).slice(0, 300), creada: Date.now(), hecho: null });
          saveNow();
          return send(res, 200, { ok: true });
        }
        if (p === '/cambios-demo' && req.method === 'POST') {
          const b = await readJson(req);
          const conv = ventas.ventasState.convs[b.conv];
          if (!conv || !b.cambios) return send(res, 400, { error: 'Falta conv o cambios.' });
          dev.cambiosDesdeVenta(conv, b.cambios).catch((e) => log('constructor', `Cambios de ${conv.title}: ${e.message}`, 'error'));
          return send(res, 202, { ok: true });
        }
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/enviar$/))) { const b = await readJson(req); await wa.sendAsTeam(m[1], b.texto); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/(pausar|reactivar)$/))) { (m[2] === 'pausar' ? wa.pauseManual : wa.resume)(m[1]); return send(res, 200, { ok: true }); }
        if (req.method === 'GET' && p === '/seguimientos') return send(res, 200, wa.seguimientosInfo());
        if (p === '/cuenta-prueba' && req.method === 'POST') { try { return send(res, 200, await wa.pruebaCuenta()); } catch (e) { return send(res, 400, { error: e.message }); } }
        if (p === '/cuenta-imagen') {
          if (req.method === 'GET') { if (!fs.existsSync(wa.CUENTA_IMG)) return send(res, 404, 'Sin imagen', 'text/plain'); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); return fs.createReadStream(wa.CUENTA_IMG).pipe(res); }
          if (req.method === 'DELETE') { fs.rmSync(wa.CUENTA_IMG, { force: true }); log('vendedor', 'Diego quitó la imagen de las cuentas', 'info'); return send(res, 200, { ok: true }); }
          if (req.method === 'POST') {
            const b = await readJson(req, 15e6);
            const buf = Buffer.from(String(b.base64 || '').replace(/^data:[^,]+,/, ''), 'base64');
            if (buf.length < 2000 || buf.length > 10e6) return send(res, 400, { error: 'La imagen está vacía o pesa más de 10 MB.' });
            const tmp = `${wa.CUENTA_IMG}.subida`;
            fs.writeFileSync(tmp, buf);
            // WhatsApp manda los .webp como sticker: se pasa a JPG (máx. 1280 px de ancho).
            const ok = await new Promise((r) => { const pr = spawnPoster('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', wa.CUENTA_IMG]); pr.on('close', (c) => r(c === 0)); pr.on('error', () => r(false)); });
            fs.rmSync(tmp, { force: true });
            if (!ok) return send(res, 400, { error: 'No pude leer esa imagen. Probá con JPG o PNG.' });
            log('vendedor', 'Diego subió la imagen de las cuentas bancarias', 'ok');
            return send(res, 200, { ok: true });
          }
        }
        const mFicha = req.method === 'GET' ? p.match(/^\/conv\/([\w-]+)\/ficha$/) : null;
        if (mFicha) { const c = ventas.ventasState.convs[mFicha[1]]; if (!c) return send(res, 404, { error: 'No encontrada' }); return send(res, 200, { cotizaciones: await ventas.fichaCliente(c).catch((e) => ({ error: e.message })), cierre: c.estado?.cierre || null }); }
        const mMedia = req.method === 'GET' ? p.match(/^\/media\/([\w-]+)\/([\w.-]+)$/) : null;
        if (mMedia) {
          const f = wa.archivoMedia(mMedia[1], mMedia[2]);
          if (!f) return send(res, 404, 'No encontrado', 'text/plain');
          res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
          return fs.createReadStream(f).pipe(res);
        }
        if (req.method === 'GET' && p === '/seguimientos/proximos') return send(res, 200, { proximos: wa.proximosSeguimientos({ cliente: url.searchParams.get('cliente') || '' }), colgados: wa.chatsColgados() });
        if (req.method === 'POST' && p === '/seguimientos') { const b = await readJson(req); return send(res, 200, wa.setPasos(b.pasos)); }
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/seguimiento\/borrador$/))) return send(res, 200, await wa.borradorSeguimiento(m[1]));
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/seguimiento\/(ya|cancelar)$/))) return send(res, 200, m[2] === 'ya' ? await wa.followupNow(m[1]) : wa.cancelFollowup(m[1]));
        // Prueba: lee con IA la última imagen que mandó un cliente (la misma lectura que recibe el vendedor).
        if (req.method === 'POST' && (m = p.match(/^\/leer-imagen\/([\w-]+)$/))) {
          const f = wa.imagenesDe(m[1]).at(-1);
          if (!f) return send(res, 404, { error: 'Ese chat no tiene imágenes guardadas' });
          const { leerImagen } = await import('./ventas/imagen.mjs');
          const ext = path.extname(f).slice(1);
          return send(res, 200, { archivo: path.basename(f), lectura: await leerImagen(fs.readFileSync(f).toString('base64'), ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg') });
        }
        if (req.method === 'GET' && p === '/playbook') return send(res, 200, { texto: ventas.getPlaybook() });
        if (req.method === 'POST' && p === '/playbook') { const b = await readJson(req); ventas.savePlaybook(b.texto, 'diego', b.resumen || 'Editado por Diego'); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && p === '/config') return send(res, 200, ventas.setConfig(await readJson(req)));
        if (req.method === 'POST' && p === '/casos') return send(res, 200, { n: ventas.saveCases(await readJson(req, 8e6)) });
        if (req.method === 'POST' && p === '/nueva') return send(res, 201, ventas.newConv(await readJson(req)));
        if (req.method === 'POST' && (m = p.match(/^\/caso\/([\w-]+)$/))) return send(res, 202, await ventas.replayCase(m[1], await readJson(req)));
        if (req.method === 'GET' && (m = p.match(/^\/caso\/([\w-]+)$/))) return send(res, ventas.getCase(m[1]) ? 200 : 404, ventas.getCase(m[1]));
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/resultado$/))) { const b = await readJson(req); try { return send(res, 200, ventas.marcarResultado(m[1], b.tipo || '', b.nota || '')); } catch (e) { return send(res, 400, { error: e.message }); } }
        if (req.method === 'GET' && (m = p.match(/^\/conv\/([\w-]+)$/))) return send(res, ventas.getConv(m[1]) ? 200 : 404, ventas.getConv(m[1]));
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/msg$/))) { const b = await readJson(req); ventas.clientSays(m[1], b.texto, typeof b.model === 'string' && /^[\w./:-]{3,120}$/.test(b.model) ? { model: b.model } : {}).catch(() => {}); return send(res, 202, { ok: true }); }
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/corregir$/))) { const b = await readJson(req); return send(res, 200, ventas.correct(m[1], Number(b.index), b.corregida, b.nota)); }
        if (req.method === 'POST' && (m = p.match(/^\/conv\/([\w-]+)\/borrar$/))) { ventas.deleteConv(m[1]); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && (m = p.match(/^\/regla\/([\w-]+)$/))) { const b = await readJson(req); return send(res, 200, ventas.setRule(m[1], b.activa)); }
        return send(res, 404, { error: 'No encontrado' });
      } catch (e) {
        return send(res, 400, { error: e.message });
      }
    }
    if (url.pathname === '/api/cupo/retomar' && req.method === 'POST') { unblock(); return send(res, 200, publicCupo()); }
    if (url.pathname === '/api/cupo/ahorro' && req.method === 'POST') return send(res, 200, setAhorro(await readJson(req)));
    if (url.pathname === '/api/cupo/limites' && req.method === 'POST') return send(res, 200, setLimites(await readJson(req)));
    if (url.pathname === '/api/cupo/medir' && req.method === 'POST') { const { medirCupo } = await import('./runner.mjs'); await medirCupo().catch(() => {}); return send(res, 200, publicCupo()); }
    if (url.pathname === '/api/memoria' && req.method === 'GET') return send(res, 200, listMemoria());
    if (url.pathname === '/api/memoria' && req.method === 'POST') { const b = await readJson(req); try { return send(res, 200, remember({ indicacion: b.indicacion, para: b.para || 'todos', origen: 'Diego' })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/memoria\/([\w-]+)\/borrar$/))) return send(res, 200, { ok: forgetMemoria(m[1]) });
    if ((m = url.pathname.match(/^\/api\/biblioteca\/([0-9a-f]{10})\/borrar$/)) && req.method === 'POST') { const { borrarFicha } = await import('./videos.mjs'); borrarFicha(m[1]); return send(res, 200, { ok: true }); }
    if (url.pathname === '/api/biblioteca' && req.method === 'GET') { const { listaBiblioteca } = await import('./videos.mjs'); return send(res, 200, listaBiblioteca()); }
    if (url.pathname === '/api/biblioteca/ver' && req.method === 'POST') {
      const { verVideo } = await import('./videos.mjs');
      try { const r = await verVideo({ ...(await readJson(req)), por: 'coordinador' }); return send(res, 200, { id: r.id, titulo: r.titulo, ficha: r.ficha }); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if ((m = url.pathname.match(/^\/api\/biblioteca\/([0-9a-f]{10})$/)) && req.method === 'GET') { const { leerFicha } = await import('./videos.mjs'); const f = leerFicha(m[1]); return f ? send(res, 200, f, 'text/markdown; charset=utf-8') : send(res, 404, { error: 'No encontrado' }); }
    // Cotizaciones y proyectos de la base de Cresova (Supabase): un solo tablero para Diego y los agentes.
    // Lectura de un objeto de Meta (solo lectura, campos acotados) para revisar configuración como el número de WhatsApp.
    if (url.pathname === '/api/autonomia') { const au = await import('./autonomia.mjs'); if (req.method === 'POST') return send(res, 200, au.setConfig(await readJson(req))); return send(res, 200, au.config()); }
    if (req.method === 'GET' && url.pathname === '/api/autonomia/presupuesto') { try { return send(res, 200, await (await import('./autonomia.mjs')).presupuesto()); } catch (e) { return send(res, 502, { error: e.message }); } }
    if (url.pathname === '/api/reunion') {
      if (req.method === 'GET') return send(res, 200, { reunion: reuniones.actual() });
      // Correr una reunión a mano (prueba o urgencia): {tipo: 'semanal'|'direccion'|'mensual'}
      const { tipo, depto } = await readJson(req);
      const fn = tipo === 'semanal' && depto ? () => reuniones.semanal(depto) : { semanal: reuniones.semanales, direccion: reuniones.direccion, mensual: reuniones.mensual }[tipo];
      if (!fn) return send(res, 400, { error: 'tipo inválido' });
      if (reuniones.actual()) return send(res, 409, { error: 'Ya hay una reunión en curso' });
      fn().catch((e) => log(null, `Reunión ${tipo}: ${e.message}`, 'warn'));
      return send(res, 200, { ok: true });
    }
    // Google Calendar para las reuniones con clientes (ventas/citas.mjs).
    if (req.method === 'GET' && url.pathname === '/api/google/conectar') { try { res.writeHead(302, { Location: (await import('./ventas/citas.mjs')).urlConectar() }); return res.end(); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'GET' && url.pathname === '/api/google/callback') {
      try { await (await import('./ventas/citas.mjs')).callback(url.searchParams.get('code'), url.searchParams.get('state')); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:24px"><h2>Google Calendar conectado ✅</h2><p>El bot ya puede ofrecer y agendar reuniones por Google Meet en tu calendario. Podés cerrar esta pestaña.</p></body>'); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<body style="font-family:sans-serif;padding:24px"><h2>No se pudo conectar</h2><p>${String(e.message).replace(/</g, '&lt;')}</p></body>`); }
    }
    if (req.method === 'GET' && url.pathname === '/api/citas') return send(res, 200, (await import('./ventas/citas.mjs')).estado());
    if (req.method === 'GET' && url.pathname === '/api/citas/huecos') { try { return send(res, 200, await (await import('./ventas/citas.mjs')).huecos({ cuantos: 6 })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'POST' && url.pathname === '/api/citas/config') return send(res, 200, (await import('./ventas/citas.mjs')).configurar(await readJson(req).catch(() => ({}))));
    if (req.method === 'POST' && url.pathname === '/api/citas/agendar') { try { const b = await readJson(req); const { ventasState: VS } = await import('./ventas/vendedor.mjs'); const cv = VS.convs[b.conv]; if (!cv) return send(res, 404, { error: 'No existe esa conversación.' }); return send(res, 200, await (await import('./ventas/citas.mjs')).agendar({ conv: cv, inicio: b.inicio, tema: b.tema || '', con_quien: b.con_quien || '', por: 'Diego' })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'GET' && url.pathname === '/api/ficha') { try { const fp = url.searchParams; const ficha = await (await import('./cresova/ficha.mjs')).fichaUnica({ tel: fp.get('tel'), conv: fp.get('conv'), cliente: fp.get('cliente') }); return ficha ? send(res, 200, ficha) : send(res, 404, { error: 'No encontré ese cliente.' }); } catch (e) { return send(res, 500, { error: e.message }); } }
    if (req.method === 'GET' && url.pathname === '/api/pauta') { try { return send(res, 200, await (await import('./pauta/index.mjs')).tablero(Math.max(1, Math.min(90, Number(url.searchParams.get('dias')) || 30)))); } catch (e) { return send(res, 500, { error: e.message }); } }
    // Prospección: campañas de búsqueda en Google Maps, investigación con IA y contacto aprobado por Diego.
    if (url.pathname.startsWith('/api/prospeccion')) {
      const p = url.pathname.slice('/api/prospeccion'.length);
      let m;
      try {
        if (req.method === 'GET' && p === '') return send(res, 200, await prosp.resumen());
        if (req.method === 'GET' && p === '/prospectos') return send(res, 200, await prosp.prospectos({ campana: url.searchParams.get('campana'), estado: url.searchParams.get('estado') }));
        if (req.method === 'GET' && (m = p.match(/^\/prospectos\/(\d+)$/))) { const x = await prosp.prospecto(Number(m[1])); return send(res, x ? 200 : 404, x || { error: 'No encontrado' }); }
        if (req.method === 'POST' && (m = p.match(/^\/prospectos\/(\d+)$/))) return send(res, 200, await prosp.accion(Number(m[1]), await readJson(req)));
        if (req.method === 'POST' && (m = p.match(/^\/prospectos\/(\d+)\/prueba$/))) return send(res, 200, await prosp.prueba(Number(m[1]), (await readJson(req)).canal));
        if (req.method === 'POST' && p === '/campanas') return send(res, 200, await prosp.crearCampana(await readJson(req)));
        if (req.method === 'POST' && (m = p.match(/^\/campanas\/(\d+)\/buscar$/))) return send(res, 200, await prosp.buscarDeNuevo(Number(m[1])));
        if (req.method === 'POST' && (m = p.match(/^\/campanas\/(\d+)\/reinvestigar$/))) return send(res, 200, await prosp.reinvestigarCampana(Number(m[1])));
        if (req.method === 'POST' && p === '/config') return send(res, 200, prosp.setConfig(await readJson(req)));
        if (req.method === 'POST' && p === '/numero/conectar') return send(res, 200, await prosp.conectarNumero());
        if (req.method === 'GET' && p === '/numero') return send(res, 200, await prosp.estadoNumero(true));
        return send(res, 404, { error: 'No encontrado' });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (url.pathname.startsWith('/api/cresova/')) {
      const q = url.pathname.slice('/api/cresova'.length);
      let mc;
      try {
        if (!cdb.configurado()) return send(res, 503, { error: 'La base de Cresova todavía no está conectada (Sistema → Llaves → Base de datos de Cresova).', configurado: false });
        if (req.method === 'GET' && q === '/estado') return send(res, 200, await cdb.conteos());
        // Copia desde cresova.com (endpoint temporal de solo lectura). Se puede repetir: actualiza por id.
        if (req.method === 'POST' && q === '/sincronizar') {
          const key = process.env.CRESOVA_MCP_API_KEY?.trim();
          if (!key) return send(res, 400, { error: 'Falta la llave del MCP de Cresova (Sistema → Llaves).' });
          const out = {};
          // Después del corte la base propia es la oficial: de cresova.com solo se traen los gastos nuevos que n8n
          // todavía mande allá (hasta que se cambie la URL), sin pisar nada.
          const tablas = state.cresovaCorte ? ['expenses'] : cdb.TABLAS;
          for (const t of tablas) {
            const r = await fetch(`https://cresova.com/api/public/oficina-export?tabla=${t}`, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(60_000) });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) return send(res, 502, { error: `cresova.com respondió ${r.status} en ${t}: ${j.error || ''}`.trim(), copiadas: out });
            out[t] = { origen: j.total ?? (j.filas || []).length, copiadas: await cdb.upsert(t, j.filas || [], { soloNuevas: Boolean(state.cresovaCorte) }) };
          }
          log(null, `Base de Cresova sincronizada desde cresova.com: ${Object.entries(out).map(([t, v]) => `${t} ${v.copiadas}`).join(', ')}`, 'ok');
          return send(res, 200, { ok: true, tablas: out, conteos: (await cdb.conteos()).tablas });
        }
        // Verificación sin efectos: el caso del vendedor se crea y se deshace; el recontacto solo cuenta.
        if (req.method === 'POST' && q === '/verificar') {
          const caso = await cdb.crearCaso({ nombre: 'Prueba de verificación', empresa: 'Prueba', telefono: '+50400000000', rubro: 'prueba', paquete: 'Web Pro', precio: 8500, notas: 'verificación', prueba: true });
          const [rc] = await cdb.q(`select count(*)::int as n from quotes where status in ('sent', 'draft')`);
          return send(res, 200, { enUso: cdb.enUso(), cotizacionDePrueba: caso, recontactoPendientes: rc.n, cotizacionesTotales: (await cdb.q('select count(*)::int as n from quotes'))[0].n });
        }
        if (req.method === 'POST' && q === '/corte') { const b = await readJson(req); return send(res, 200, { corte: cdb.corte(Boolean(b.on)) }); }
        if (q.startsWith('/meta')) {
          const meta = await import('./cresova/meta.mjs');
          if (req.method === 'GET' && q === '/meta') return send(res, 200, { ...(await meta.estado()), mensajeria: (await import('./cresova/meta-mensajeria.mjs')).estado() });
          if (req.method === 'POST' && q === '/meta/mensajeria') { const b = await readJson(req).catch(() => ({})); return send(res, 200, await (await import('./cresova/meta-mensajeria.mjs')).barrer({ codigoPrueba: b.codigo || null })); }
          if (req.method === 'POST' && q === '/meta/probar') return send(res, 200, await meta.probar());
          if (req.method === 'POST' && q === '/meta/enviar') return send(res, 200, await meta.barrer());
        }
        if (q === '/resumen') {
          const { resumenSemanal } = await import('./cresova/resumen.mjs');
          const texto = await resumenSemanal();
          if (req.method === 'POST') await wa.messageOwner(texto);
          return send(res, 200, { texto, enviado: req.method === 'POST' });
        }
        if ((mc = q.match(/^\/cotizaciones\/([\w-]+)\/pdf$/)) && req.method === 'GET') {
          const cp = await import('./cresova/cotizacion-pdf.mjs');
          const pdf = await cp.cotizacionPDF(mc[1]).catch((e) => { log(null, `No se pudo armar el PDF de la cotización: ${e.message}`, 'warn'); return null; });
          if (!pdf) return send(res, 404, { error: 'No se pudo armar el PDF' });
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${await cp.nombrePDF(mc[1])}"`, 'Cache-Control': 'no-store' });
          return res.end(pdf);
        }
        if (q === '/renovaciones' && req.method === 'GET') return send(res, 200, await (await import('./cresova/renovaciones.mjs')).lista());
        if ((mc = q.match(/^\/renovaciones\/([\w-]+)$/)) && req.method === 'PUT') return send(res, 200, await (await import('./cresova/renovaciones.mjs')).actualizar(mc[1], await readJson(req)));
        if (q === '/posventa' && req.method === 'GET') return send(res, 200, await (await import('./cresova/posventa.mjs')).vistaPrevia());
        if (q === '/posventa/config' && req.method === 'POST') return send(res, 200, (await import('./cresova/posventa.mjs')).configurar(await readJson(req)));
        if (q === '/cobranza' && req.method === 'GET') { const cb = await import('./cresova/cobranza.mjs'); return send(res, 200, { ...(await cb.vistaPrevia()), texto: await cb.listaSemanal() }); }
        if (q === '/cobranza/probar' && req.method === 'POST') { const b = await readJson(req); return send(res, 200, await (await import('./cresova/cobranza.mjs')).cobrarAnticipo({ cotizacion: b.cotizacion, probar: true })); }
        if (q === '/cobranza/config' && req.method === 'POST') return send(res, 200, (await import('./cresova/cobranza.mjs')).configurar(await readJson(req)));
        if (q === '/cobranza/lista' && req.method === 'POST') { const cb = await import('./cresova/cobranza.mjs'); const texto = await cb.listaSemanal(); const { mensajeDiscord } = await import('./voz.mjs'); await mensajeDiscord(texto.slice(0, 1990)); return send(res, 200, { enviado: true, texto }); }
        if (req.method === 'POST' && q === '/respaldo') return send(res, 200, await respaldoCompleto());
        if (req.method === 'GET' && q === '/proyectos') return send(res, 200, { corte: state.cresovaCorte || null, etapas: cdb.ETAPAS, proyectos: await cdb.proyectos({ entregados: url.searchParams.get('entregados') === '1' }), pixel: dev.listarProyectos().filter((p) => p.origen?.cotizacion).map((p) => ({ cotizacion: p.origen.cotizacion, id: p.id, tieneBuild: p.tieneBuild, compilado: p.compilado || p.actualizado, estado: p.estado, trabajando: p.trabajando, preview: p.preview, envioProgramado: p.envioProgramado || null })) });
        if (req.method === 'GET' && q === '/cuentas') return send(res, 200, await cdb.cuentas());
        if (req.method === 'POST' && (mc = q.match(/^\/proyectos\/([\w-]+)\/mover$/))) { const b = await readJson(req); return send(res, 200, await cdb.mover(mc[1], b.etapa, { demoUrl: b.demo_url || '', nota: b.nota || '' })); }
        if (req.method === 'POST' && (mc = q.match(/^\/proyectos\/([\w-]+)\/pago$/))) { const b = await readJson(req); return send(res, 200, await cdb.pago(mc[1], b)); }
        // Módulos de negocio (lo que antes estaba en cresova.com/app).
        {
          const neg = await import('./cresova/negocio.mjs');
          const sp = Object.fromEntries(url.searchParams);
          const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req, 2e6).catch(() => ({})) : null;
          let mn;
          if (req.method === 'GET' && q === '/cotizaciones') return send(res, 200, await neg.cotizaciones({ estado: sp.estado || 'all', buscar: sp.q || '' }));
          if (req.method === 'POST' && q === '/cotizaciones') return send(res, 201, await neg.guardarCotizacion(null, body));
          if (req.method === 'GET' && q === '/productos') return send(res, 200, await neg.productos());
          if (req.method === 'GET' && q === '/reporte-periodo') return send(res, 200, await (await import('./cresova/reporte-periodo.mjs')).reportePeriodo({ desde: sp.desde, hasta: sp.hasta }));
          if (req.method === 'GET' && q === '/plantilla-agente') return send(res, 200, (await import('./cresova/plantilla-agente.mjs')).PLANTILLA_AGENTE);
          if (req.method === 'POST' && (mn = q.match(/^\/cotizaciones\/([\w-]+)\/duplicar$/))) return send(res, 201, await neg.duplicarCotizacion(mn[1]));
          if (req.method === 'GET' && q === '/vendedores') return send(res, 200, await neg.vendedores());
          if ((mn = q.match(/^\/cotizaciones\/([\w-]+)$/))) {
            if (req.method === 'GET') { const c = await neg.cotizacion(mn[1]); return c ? send(res, 200, c) : send(res, 404, { error: 'No encontrada' }); }
            if (req.method === 'PUT') return send(res, 200, await neg.guardarCotizacion(mn[1], body));
            if (req.method === 'DELETE') return send(res, 200, await neg.borrarCotizacion(mn[1]));
          }
          if (req.method === 'POST' && (mn = q.match(/^\/cotizaciones\/([\w-]+)\/estado$/))) return send(res, 200, await neg.estadoCotizacion(mn[1], body.estado));
          if (req.method === 'POST' && (mn = q.match(/^\/cotizaciones\/([\w-]+)\/pago$/))) { await cdb.pago(mn[1], body); return send(res, 200, await neg.cotizacion(mn[1])); }
          if (req.method === 'DELETE' && (mn = q.match(/^\/pagos\/([\w-]+)$/))) return send(res, 200, await neg.borrarPago(mn[1]));
          if (req.method === 'POST' && (mn = q.match(/^\/pagos\/([\w-]+)\/cuenta$/))) return send(res, 200, await neg.asignarCuentaPago(mn[1], body.cuenta));
          if (req.method === 'GET' && q === '/tesoreria') return send(res, 200, await neg.tesoreria({ desde: sp.desde, hasta: sp.hasta }));
          if (req.method === 'GET' && q === '/gastos') return send(res, 200, await neg.gastos({ desde: sp.desde, hasta: sp.hasta, categoria: sp.categoria, estado: sp.estado, buscar: sp.q, sinCategoria: sp.sinCategoria === '1' }));
          if (req.method === 'POST' && q === '/gastos') return send(res, 201, await neg.guardarGasto(null, body));
          if (req.method === 'GET' && q === '/anuncios') return send(res, 200, await (await import('./cresova/atribucion.mjs')).anuncios({ desde: sp.desde, hasta: sp.hasta }));
          if (req.method === 'GET' && q === '/personales') return send(res, 200, await neg.personalesDiego());
          if (req.method === 'POST' && q === '/retiro') return send(res, 201, await neg.registrarRetiro(body));
          if (req.method === 'POST' && q === '/personales-a-nomina') return send(res, 200, { pasados: await neg.personalesANomina() });
          if (req.method === 'GET' && q === '/gastos-sugerencias') return send(res, 200, await neg.sugerenciasGastos());
          if (req.method === 'POST' && q === '/gastos-categorizar') return send(res, 200, await neg.categorizarGastos(body.ids, body.category_id));
          if ((mn = q.match(/^\/gastos\/([\w-]+)$/))) {
            if (req.method === 'PUT') return send(res, 200, await neg.guardarGasto(mn[1], body));
            if (req.method === 'DELETE') return send(res, 200, await neg.borrarGasto(mn[1]));
          }
          if (req.method === 'GET' && q === '/categorias') return send(res, 200, await neg.categorias());
          if (req.method === 'GET' && q === '/costos-fijos') return send(res, 200, await neg.costosFijos());
          if (req.method === 'GET' && q === '/transferencias') return send(res, 200, await neg.transferencias());
          if (req.method === 'POST' && q === '/transferencias') return send(res, 201, await neg.transferir(body));
          if (req.method === 'GET' && q === '/planilla') return send(res, 200, await neg.planilla());
          if (req.method === 'GET' && q === '/pagos-sin-cuenta') return send(res, 200, await neg.pagosSinCuenta());
          if (req.method === 'GET' && q === '/clientes') return send(res, 200, await neg.clientes({ buscar: sp.q, estado: sp.estado }));
          if (req.method === 'POST' && q === '/clientes') return send(res, 201, await neg.guardarCliente(null, body));
          if ((mn = q.match(/^\/clientes\/([\w-]+)$/))) {
            if (req.method === 'GET') {
              const c = await neg.cliente(mn[1]);
              if (!c) return send(res, 404, { error: 'No encontrado' });
              // Su conversación de WhatsApp en la oficina (por los últimos 8 dígitos del teléfono) y el anuncio del que vino.
              const tel = String(c.phone || c.telefono_normalizado || '').replace(/\D/g, '').slice(-8);
              const conv = tel.length === 8 ? Object.values(ventas.ventasState.convs).find((x) => x.kind === 'whatsapp' && String(x.phone || '').replace(/\D/g, '').endsWith(tel)) : null;
              if (conv) c.whatsapp = { etapa: etapaNombre(conv), id: conv.id, anuncio: conv.anuncio || null, pausa: conv.pausa?.motivo || null, resultado: conv.estado?.resultado || null, atiende: conv.pausa ? 'Diego' : 'El vendedor (IA)', demo: conv.estado?.demoUrl || null, demoEnviada: conv.estado?.demoEnviada || null, cierre: conv.estado?.cierre || null, proximos: wa.proximosSeguimientos({ cliente: conv.phone }), mensajes: conv.msgs.filter((m) => ['cliente', 'bot', 'equipo'].includes(m.role)).slice(-40).map((m) => ({ quien: m.role, texto: String(m.text || '').slice(0, 1200), ts: m.ts, previo: Boolean(m.previo) })) };
              return send(res, 200, c);
            }
            if (req.method === 'PUT') return send(res, 200, await neg.guardarCliente(mn[1], body));
          }
          if (req.method === 'GET' && q === '/tareas') return send(res, 200, await neg.tareas({ estado: sp.estado || 'pending' }));
          if (req.method === 'POST' && q === '/tareas') return send(res, 201, await neg.guardarTarea(null, body));
          if ((mn = q.match(/^\/tareas\/([\w-]+)$/))) {
            if (req.method === 'PUT') return send(res, 200, await neg.guardarTarea(mn[1], body));
            if (req.method === 'DELETE') return send(res, 200, await neg.borrarTarea(mn[1]));
          }
          if (req.method === 'GET' && q === '/analiticas') return send(res, 200, await neg.analiticas({ meses: sp.meses }));
        }
        return send(res, 404, { error: 'No encontrado' });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (url.pathname.startsWith('/api/proyectos')) {
      const q = url.pathname.slice('/api/proyectos'.length);
      let mm0;
      try {
        if (req.method === 'GET' && q === '') return send(res, 200, dev.listarProyectos());
        if (req.method === 'GET' && q === '/reglas') return send(res, 200, dev.listarReglas());
        if ((mm0 = q.match(/^\/desde-venta\/([\w-]+)$/)) && req.method === 'POST') {
          const { ventasState } = await import('./ventas/vendedor.mjs');
          const conv = ventasState.convs[mm0[1]];
          if (!conv) return send(res, 404, { error: 'Conversación no encontrada' });
          return send(res, 201, dev.publicProyecto(await dev.desdeVenta(conv)));
        }
        if ((mm0 = q.match(/^\/reglas\/(\d+)\/borrar$/)) && req.method === 'POST') return send(res, 200, dev.borrarRegla(mm0[1]));
        if ((mm0 = q.match(/^\/reglas\/(\d+)$/)) && req.method === 'POST') return send(res, 200, dev.editarRegla(mm0[1], (await readJson(req)).regla));
        if (req.method === 'POST' && q === '') {
          const b = await readJson(req, 2e5);
          if (b.referencias?.trim()) b.brief = `${b.brief || ''}\n\n## Sitios de referencia que le gustan a Diego (miralos con mirar_referencia antes de diseñar)\n${b.referencias.trim()}`;
          if ((b.pedido || '').trim().length > 800) { b.brief = `${b.brief || ''}

## Brief completo de Diego (seguilo al pie de la letra)
${b.pedido.trim()}`; b.pedido = ''; }
          const p = await dev.crearProyecto({ ...b, por: 'diego' });
          // La primera vuelta arranca sola: la demo completa según el brief.
          dev.pedir(p.id, b.pedido?.trim() || 'Armá la demo completa del sitio según el brief: decidí el diseño, escribí el contenido, generá las fotos, compilá y revisá las capturas hasta que quede excelente.').catch((e) => log('constructor', `Demo de ${p.nombre}: ${e.message}`, 'error'));
          return send(res, 201, dev.publicProyecto(p));
        }
        let mm;
        if ((mm = q.match(/^\/([a-z0-9-]+)$/)) && req.method === 'GET') { const p = dev.getProyecto(mm[1]); return p ? send(res, 200, { ...dev.publicProyecto(p), chat: dev.chatDe(p.id) }) : send(res, 404, { error: 'No encontrado' }); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/pedir$/)) && req.method === 'POST') { const b = await readJson(req, 2e5); const enCola = dev.ocupado(mm[1]); const pr = dev.pedir(mm[1], b.texto, { fuerte: Boolean(b.rediseno), revisar: Boolean(b.rediseno) }); const err = await Promise.race([pr.then(() => null, (e) => e.message), new Promise((r) => setTimeout(() => r(null), 1500))]); if (err) return send(res, 409, { error: err }); return send(res, 202, { ok: true, enCola }); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/compilar$/)) && req.method === 'POST') { if (dev.ocupado(mm[1])) return send(res, 409, { error: 'Está trabajando.' }); await dev.compilar(mm[1]); dev.capturas(mm[1]).catch(() => {}); return send(res, 200, { ok: true }); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/enviar$/)) && req.method === 'POST') { const b = await readJson(req).catch(() => ({})); return send(res, 200, await dev.enviarDemo(mm[1], { ahora: Boolean(b?.ahora), cuando: Number(b?.cuando) || null })); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/cancelar-envio$/)) && req.method === 'POST') return send(res, 200, dev.cancelarEnvio(mm[1]));
        if ((mm = q.match(/^\/([a-z0-9-]+)\/fotos$/)) && req.method === 'POST') { const b = await readJson(req, 36e6); return send(res, 200, { ruta: await dev.subirFoto(mm[1], b.nombre, b.base64) }); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/revisar$/)) && req.method === 'POST') { if (dev.ocupado(mm[1])) return send(res, 409, { error: 'El constructor todavía está trabajando.' }); dev.pedir(mm[1], 'Pasalo por el revisor de calidad y aplicá lo que encuentre.', { revisar: true }).catch(() => {}); return send(res, 202, { ok: true }); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/detener$/)) && req.method === 'POST') { dev.detener(mm[1]); return send(res, 200, { ok: true }); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/versiones$/)) && req.method === 'GET') return send(res, 200, await dev.versiones(mm[1]));
        if ((mm = q.match(/^\/([a-z0-9-]+)\/volver$/)) && req.method === 'POST') { const b = await readJson(req); return send(res, 200, await dev.volverA(mm[1], String(b.hash || ''))); }
        if ((mm = q.match(/^\/([a-z0-9-]+)\/estado$/)) && req.method === 'POST') { const b = await readJson(req); return send(res, 200, dev.setEstado(mm[1], String(b.estado || ''))); }
        return send(res, 404, { error: 'No encontrado' });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if ((m = url.pathname.match(/^\/api\/doc\/([\w-]+?)(\.pdf)?$/)) && req.method === 'GET') {
      const docs = await import('./documentos.mjs');
      if (!m[2]) { const html = docs.docHTML(m[1]); return html ? send(res, 200, html, 'text/html; charset=utf-8') : send(res, 404, { error: 'No encontrado' }); }
      const pdf = await docs.docPDF(m[1]).catch((e) => { log(null, `No se pudo armar el PDF: ${e.message}`, 'warn'); return null; });
      if (!pdf) return send(res, 404, { error: 'No se pudo armar el PDF' });
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${docs.nombreArchivo(m[1])}"`, 'Cache-Control': 'no-store' });
      return res.end(pdf);
    }
    // ¿De qué app de Meta es el token de la oficina? (para saber cuál pasar a modo público). Solo lectura; el token no sale.
    if (url.pathname === '/api/meta/app' && req.method === 'GET') {
      const tk = process.env.METAADS_TOKEN?.trim();
      if (!tk) return send(res, 200, { error: 'Falta la llave de Meta.' });
      const j = await fetch(`https://graph.facebook.com/v21.0/app?fields=id,name,link,category&access_token=${encodeURIComponent(tk)}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch((e) => ({ error: { message: e.message } }));
      return send(res, 200, j.error ? { error: j.error.message } : { id: j.id, nombre: j.name, categoria: j.category || null });
    }
    if (url.pathname === '/api/meta/prueba' && req.method === 'POST') { const { probarMeta } = await import('./connections.mjs'); try { return send(res, 200, await probarMeta()); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    if (url.pathname === '/api/programados' && req.method === 'GET') return send(res, 200, state.programados);
    if (url.pathname === '/api/programados' && req.method === 'POST') {
      const b = await readJson(req, 2e5);
      if (!getAgent(b.agentId) || !b.instruction || !(b.at > Date.now())) return send(res, 400, { error: 'Falta el agente, la instrucción o una fecha futura.' });
      const item = { id: randomUUID(), agentId: b.agentId, titulo: String(b.titulo || 'Encargo').slice(0, 140), instruction: String(b.instruction).slice(0, 20000), at: Number(b.at), ts: Date.now() };
      state.programados.push(item);
      log(item.agentId, `Encargo programado para ${new Date(item.at).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa' })}: ${item.titulo}`, 'info');
      return send(res, 201, item);
    }
    if (url.pathname === '/api/linea' && req.method === 'GET') return send(res, 200, publicLinea());
    if (url.pathname === '/api/linea' && req.method === 'POST') return send(res, 200, setLinea(await readJson(req)));
    if (req.method === 'POST' && url.pathname === '/api/enlaces/registrar') { const b = await readJson(req); try { return send(res, 200, (await import('./enlaces.mjs')).registrarEnMeta(b.entregable, { video_id: b.video_id, anuncio_id: b.anuncio_id })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'POST' && url.pathname === '/api/enlaces/video') { const b = await readJson(req); try { return send(res, 200, (await import('./enlaces.mjs')).crearEnlace(b.entregable, { horas: b.horas, por: 'diego' })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'POST' && url.pathname === '/api/linea/en-tarea') { const b = await readJson(req); const { enTarea } = await import('./linea.mjs'); return send(res, 200, { marcados: enTarea(b.ids || [], String(b.taskId || ''), b.editor || 'video') }); }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/linea\/quitar\/([\w-]+)$/))) return send(res, removeQueued(m[1]) ? 200 : 404, publicLinea());
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/estudio\/tipo\/([\w-]+)$/))) {
      const d = state.deliverables.find((x) => x.id === m[1] && x.kind === 'video');
      const { tipo } = await readJson(req);
      if (!d || !['anuncio', 'organico'].includes(tipo)) return send(res, 400, { error: 'Video o tipo inválido.' });
      if (d.published) return send(res, 400, { error: 'Ya está programado como orgánico: cancelá la publicación primero.' });
      d.tipo = tipo; saveNow();
      log('diego', `Marcó "${d.title}" como ${tipo === 'anuncio' ? 'ANUNCIO (Meta)' : 'ORGÁNICO (redes)'}`, 'info');
      return send(res, 200, { ok: true, tipo });
    }
    if (url.pathname === '/api/estudio/redes' && req.method === 'GET') { const pb = await import('./publicador.mjs'); return send(res, 200, { ...(state.redes?.ultimo || {}), pendientesIgFb: pb.pendientesIgFb() }); }
    if (url.pathname === '/api/estudio/corregir-numero' && req.method === 'POST') { try { const b = await readJson(req).catch(() => ({})); return send(res, 200, await (await import('./publicador.mjs')).corregirNumeroProgramadas({ limite: Number(b.limite) || 500, probar: Boolean(b.probar) })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/reglas' && req.method === 'GET') { try { const pb = await import('./publicador.mjs'); return send(res, 200, { reglas: pb.reglas(), reserva: await pb.reserva(), igfb: state.redes?.ultimaEleccionIgFb || null }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/reglas' && req.method === 'POST') { try { return send(res, 200, (await import('./publicador.mjs')).guardarReglas(await readJson(req))); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/rellenar-huecos' && req.method === 'POST') { try { const b = await readJson(req).catch(() => ({})); return send(res, 200, await (await import('./publicador.mjs')).rellenarHuecos({ dias: Math.min(14, Number(b.dias) || 3) })); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/publicar-aprobados' && req.method === 'POST') { try { return send(res, 200, await (await import('./publicador.mjs')).publicarAprobados()); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/igfb-elegir' && req.method === 'POST') { try { return send(res, 200, await (await import('./publicador.mjs')).elegirMejorIgFb()); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/redes/revisar' && req.method === 'POST') { try { const pb = await import('./publicador.mjs'); return send(res, 200, { ...(await pb.vigilarRedes()), pendientesIgFb: pb.pendientesIgFb() }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/estudio\/igfb\/([\w-]+)$/))) { try { return send(res, 200, await (await import('./publicador.mjs')).programarIgFb(m[1])); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/calendario' && req.method === 'GET') return send(res, 200, calendarState());
    if (url.pathname === '/api/estudio/calendario/revisar' && req.method === 'POST') { try { return send(res, 200, await auditCalendar()); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (url.pathname === '/api/estudio/next-slot') {
      try { const at = await nextSlot(); return send(res, 200, { at, label: hnLabel(at) }); } catch (e) { return send(res, 200, { error: e.message }); }
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/estudio\/(publish|unpublish)\/([\w-]+)$/))) {
      try {
        if (m[1] === 'unpublish') { await cancelPublish(m[2]); return send(res, 200, { ok: true }); }
        const { title, caption } = await readJson(req);
        return send(res, 200, await publishVideo(m[2], { title, caption }));
      } catch (e) {
        log('community', `No se pudo programar: ${e.message}`, 'error');
        return send(res, 400, { error: e.message });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/tareas') {
      const b = await readJson(req);
      return send(res, 201, createTask({ assignee: b.assignee, title: b.title, description: b.description, priority: b.priority, createdBy: 'diego' }));
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/tareas\/([\w-]+)$/))) {
      const b = await readJson(req);
      const patch = {};
      for (const k of ['status', 'note', 'priority', 'assignee', 'title', 'description']) if (k in b) patch[k] = b[k];
      return send(res, 200, updateTask(m[1], patch, 'diego'));
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/grupo(?:\/(\w+))?$/))) {
      const dept = m[1] || DEPARTMENTS[0].id;
      if (!isDept(dept)) return send(res, 404, { error: 'Ese departamento no existe.' });
      const { message } = await readJson(req);
      const text = typeof message === 'string' ? message.trim().slice(0, 4000) : '';
      if (!text) return send(res, 400, { error: 'Mensaje vacío' });
      if (groupBusy(dept)) return send(res, 409, { error: 'El equipo todavía está respondiendo. Esperá un momento.' });
      postGroup(dept, text, { reply: DEMO ? demoGroupReply : groupReply, busy })
        .catch((e) => log(null, `Chat grupal: ${e.message}`, 'warn'));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/estudio/upload') {
      return send(res, 200, await receiveUpload(req, url.searchParams.get('destino') === 'plugin' ? 'plugin' : 'estudio'));
    }
    if (url.pathname === '/api/estudio') {
      return send(res, 200, { videos: listVideos(), jobs: listJobs() });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/estudio/render/') && url.pathname.endsWith('/cancelar')) {
      try { return send(res, 200, cancelarRender(url.pathname.split('/')[4])); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/estudio/render/') && url.pathname.endsWith('/priorizar')) {
      try { return send(res, 200, priorizarRender(url.pathname.split('/')[4])); } catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/estudio/render') {
      return send(res, 202, startRender(await readJson(req)));
    }
    // Portada del video (un cuadro del segundo 1), para que el Estudio no muestre cuadros negros. Se guarda junto al render.
    if ((m = url.pathname.match(/^\/api\/estudio\/poster\/([\w-]+)\/([^/]+)$/))) {
      const file = renderFile(m[1], decodeURIComponent(m[2]));
      if (!file) return send(res, 404, 'No encontrado', 'text/plain');
      const jpg = `${file}.poster.jpg`;
      if (!fs.existsSync(jpg)) {
        await new Promise((ok) => { const pr = spawnPoster('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5', jpg]); pr.on('close', ok); pr.on('error', ok); });
        if (!fs.existsSync(jpg)) return send(res, 404, 'Sin portada', 'text/plain');
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(jpg).pipe(res);
    }
    if ((m = url.pathname.match(/^\/api\/estudio\/file\/([\w-]+)\/([^/]+)$/))) {
      const file = renderFile(m[1], decodeURIComponent(m[2]));
      if (!file) return send(res, 404, 'No encontrado', 'text/plain');
      // Rangos: Safari en iPhone los exige para reproducir y adelantar el video.
      const size = fs.statSync(file).size;
      const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (r && (r[1] || r[2])) {
        const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
        const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/api/settings/global') {
      const { paused } = await readJson(req);
      setPaused(paused);
      return send(res, 200, publicSettings());
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/settings\/agent\/(\w+)$/))) {
      const patch = await readJson(req);
      return send(res, 200, updateAgent(m[1], patch));
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/settings\/(knowledge|manual|prompt)(?:\/(\w+))?$/))) {
      const { text, reset, restore } = await readJson(req);
      if (reset) resetText(m[1], m[2]);
      else if (restore) restoreText(m[1], m[2], restore);
      else saveText(m[1], m[2], text);
      return send(res, 200, publicSettings());
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/stop\/(\w+)$/))) {
      stopAgent(m[1]);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/demo-day') {
      if (!DEMO) return send(res, 400, { error: 'Solo disponible en modo demo' });
      runDemoDay();
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/api\/approvals\/([\w-]+)$/))) {
      const { decision, note, todas } = await readJson(req);
      const a = state.approvals.find((x) => x.id === m[1]);
      const ok = resolveApproval(m[1], decision, typeof note === 'string' ? note.slice(0, 500) : '');
      // "Aprobar todas": las que esperan del mismo agente y la misma acción, y permiso por 3 horas para las que vengan.
      if (todas && a && decision === 'approved') {
        for (const x of state.approvals.filter((y) => y.status === 'pending' && y.agentId === a.agentId && y.tool === a.tool)) resolveApproval(x.id, 'approved', 'Aprobada en lote');
        permitir(a.agentId, a.tool, 3);
        log(a.agentId, `Diego aprobó todas las "${a.tool.split('__').slice(1).join(' · ')}" por 3 horas`, 'ok');
      }
      return send(res, ok ? 200 : 404, { ok });
    }
    if ((m = url.pathname.match(/^\/api\/deliverables\/([\w-]+)$/))) {
      const content = readDeliverable(m[1]);
      return content == null ? send(res, 404, 'No encontrado', 'text/plain') : send(res, 200, content, 'text/markdown; charset=utf-8');
    }

    const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'No encontrado', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    // Los errores de validación de ajustes se devuelven tal cual para mostrarlos en pantalla.
    send(res, err instanceof SyntaxError ? 400 : 422, { error: err.message });
  }
});

// Horario: revisa cada 30 s qué agentes tocan según la hora de Honduras.
function localParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, hour: Number(parts.hour), minute: Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

// Elena pasó a ser Jarvis: su conversación arranca de nuevo para no arrastrar el personaje anterior (una sola vez).
if (!state.jarvisMigrado) {
  if (state.chats?.coordinador) state.chats.coordinador.sessionId = null;
  state.jarvisMigrado = true;
}

// Encargos programados una sola vez (por ejemplo: "mañana a las 8, Jarvis arranca el proyecto de leads").
state.programados ||= [];
setInterval(() => {
  if (DEMO || isPaused()) return;
  for (const p of state.programados) {
    if (p.hecho || p.at > Date.now() || busy(p.agentId)) continue;
    p.hecho = Date.now();
    log(p.agentId, `Encargo programado: ${p.titulo}`, 'info');
    if (isBlocked()) queueRetry({ agentId: p.agentId, reason: 'encargo programado', instruction: p.instruction });
    else run(p.agentId, { reason: 'encargo programado', instruction: p.instruction });
  }
}, 30_000);

state.scheduled ||= {};
setInterval(() => {
  if (DEMO && process.env.DEMO_SCHEDULE !== '1') return;
  if (isPaused()) return;
  const now = localParts(new Date());
  for (const a of getAgents()) {
    if (!a.enabled || a.onDemand) continue;
    const s = a.schedule;
    const key = `${now.date} ${s.hour}:${s.minute}`;
    const due = s.days.includes(now.day) && (now.hour > s.hour || (now.hour === s.hour && now.minute >= s.minute)) && now.hour < s.hour + 2;
    if (due && state.scheduled[a.id] !== key && !busy(a.id)) {
      state.scheduled[a.id] = key;
      if (isBlocked()) { queueRetry({ agentId: a.id, reason: 'horario' }); continue; }
      if (isAhorro()) { log(a.id, 'Hoy no corre su turno: modo ahorro de Claude.', 'warn'); continue; }
      // Sin sus llaves no tiene con qué trabajar: no corre ni manda informes vacíos.
      const missingKeys = (a.requires || []).filter((k) => !process.env[k]?.trim());
      if (missingKeys.length) { log(a.id, `No trabaja hoy: falta la llave ${missingKeys.join(', ')} (Sistema → Llaves)`, 'warn'); continue; }
      run(a.id, { reason: 'horario' });
    }
  }
}, 30_000);

startTaskWorker({ run, busy });
setTimeout(() => iniciarVoz().catch(() => {}), 5000);
// Saldo de OpenRouter: si baja de US$ 2 se avisa por WhatsApp (máximo una vez cada 12 h). Sin saldo, el vendedor deja de contestar.
state.alertaSaldo ||= 0;
setInterval(async () => {
  const saldo = await saldoOpenRouter();
  if (saldo == null || saldo >= 1 || Date.now() - (state.alertaSaldo || 0) < 3 * 86400e3) return;
  state.alertaSaldo = Date.now();
  log('vendedor', `Saldo de OpenRouter bajo: US$ ${saldo.toFixed(2)}`, 'warn');
  wa.avisarDiego(`⚠️ *Saldo de OpenRouter bajo: US$ ${saldo.toFixed(2)}.* Es el respaldo del vendedor de WhatsApp cuando no hay cupo del plan de Claude (y lo que usa para ver videos). Si llega a 0 y el plan también se agota, el vendedor deja de contestar. Recargá en openrouter.ai → Credits.`).catch(() => {});
}, 30 * 60e3);

// Medidor de cupo: cada 10 min, si nadie trabajó hace rato (los que trabajan ya traen el dato).
setInterval(async () => {
  if (DEMO || isBlocked()) return;
  const c = publicCupo();
  if (c.medido && Date.now() - c.medido < 8 * 60e3) return;
  try { const { medirCupo } = await import('./runner.mjs'); await medirCupo(); } catch {}
}, 10 * 60e3);

server.listen(PORT, () => {
  log(null, `Oficina abierta${DEMO ? ' en modo demo' : ''}`, 'system');
  console.log(`Oficina Cresova en http://localhost:${PORT}${DEMO ? ' (modo demo)' : ''}`);
});

// Respaldo diario a las 2:00 de Honduras, en /data/respaldos (las últimas 14 de cada uno):
// - la base de Cresova (cotizaciones, pagos, gastos…), y
// - el estado de la oficina (state.json: conversaciones de WhatsApp, memoria, bitácora, autonomía, proyectos,
//   más ventas/casos.json). Las llaves (secrets.json) NO se incluyen.
// Además sale una copia comprimida de cada uno por mensaje privado de Discord a Diego: la copia fuera del VPS.
const LIMITE_DISCORD = 9e6;
async function mandarDiscord(nombre, buf, texto) {
  const { archivoDiscord } = await import('./voz.mjs');
  if (buf.length <= LIMITE_DISCORD) return archivoDiscord(nombre, buf, texto);
  const partes = Math.ceil(buf.length / LIMITE_DISCORD);
  for (let i = 0; i < partes; i++) {
    await archivoDiscord(`${nombre}.parte${i + 1}de${partes}`, buf.subarray(i * LIMITE_DISCORD, (i + 1) * LIMITE_DISCORD), i ? '' : `${texto}\n(Va en ${partes} partes: se juntan una detrás de otra.)`);
  }
  return true;
}
function respaldarOficina(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fecha = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  let casos = [];
  try { casos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ventas', 'casos.json'), 'utf8')); } catch {}
  const datos = { fecha, creado: new Date().toISOString(), state, casos };
  const gz = gzipSync(Buffer.from(JSON.stringify(datos)), { level: 9 });
  const archivo = `oficina-${fecha}.json.gz`;
  fs.writeFileSync(path.join(dir, archivo + '.tmp'), gz);
  fs.renameSync(path.join(dir, archivo + '.tmp'), path.join(dir, archivo));
  const viejos = fs.readdirSync(dir).filter((f) => /^oficina-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort().slice(0, -14);
  for (const f of viejos) fs.rmSync(path.join(dir, f), { force: true });
  const conv = Object.keys(state.ventas?.convs || state.ventas?.conversaciones || {}).length;
  return { archivo, gz, kbComprimido: Math.round(gz.length / 1024), guardados: fs.readdirSync(dir).filter((f) => f.startsWith('oficina-')).length, conversaciones: conv || undefined };
}
async function respaldoCompleto() {
  const dir = path.join(DATA_DIR, 'respaldos');
  const out = { base: null, oficina: null };
  // 1) Estado de la oficina (no depende de la base).
  try {
    const o = respaldarOficina(dir);
    log(null, `Respaldo de la oficina: ${o.archivo} (${o.kbComprimido} KB comprimido)`, 'info');
    out.oficina = { archivo: o.archivo, kbComprimido: o.kbComprimido, guardados: o.guardados, conversaciones: o.conversaciones };
    try { await mandarDiscord(o.archivo, o.gz, `🗂️ Respaldo del estado de la oficina (${o.archivo.slice(8, 18)}, ${o.kbComprimido} KB): conversaciones de WhatsApp, memoria, bitácora, autonomía y proyectos. Es la copia fuera del servidor: no hace falta abrirlo.`); out.oficina.discord = true; }
    catch (e) { out.oficina.discord = false; out.oficina.error = e.message; log(null, `El respaldo de la oficina no se pudo mandar por Discord: ${e.message}`, 'warn'); }
  } catch (e) { out.oficina = { error: e.message }; log(null, `No se pudo respaldar el estado de la oficina: ${e.message}`, 'error'); }
  // 2) Base de Cresova.
  if (cdb.configurado()) {
    try {
      const r = await cdb.respaldar(dir);
      log(null, `Respaldo de la base de Cresova: ${r.archivo} (${r.kb} KB)`, 'info');
      const gz = gzipSync(fs.readFileSync(path.join(dir, r.archivo)), { level: 9 });
      out.base = { ...r, kbComprimido: Math.round(gz.length / 1024) };
      try { await mandarDiscord(`${r.archivo}.gz`, gz, `🗄️ Respaldo de la base de Cresova (${r.archivo.slice(8, 18)}, ${Math.round(gz.length / 1024)} KB). Es la copia fuera del servidor: no hace falta abrirlo, solo que quede acá.`); out.base.discord = true; }
      catch (e) { out.base.discord = false; out.base.error = e.message; log(null, `El respaldo no se pudo mandar por Discord: ${e.message}`, 'warn'); }
    } catch (e) { out.base = { error: e.message }; log(null, `No se pudo respaldar la base de Cresova: ${e.message}`, 'error'); }
  }
  const fallos = [out.oficina?.error && `oficina (${out.oficina.error})`, out.base?.error && `base (${out.base.error})`].filter(Boolean);
  if (fallos.length) wa.avisarDiego(`⚠️ Falló parte del respaldo diario: ${fallos.join('; ')}`).catch(() => {});
  return out;
}
setInterval(() => {
  const d = new Date(Date.now() - 6 * 3600e3);
  const hoy = d.toISOString().slice(0, 10);
  if (d.getUTCHours() !== 2 || state.respaldoCresova === hoy) return;
  state.respaldoCresova = hoy;
  respaldoCompleto().catch((e) => log(null, `Respaldo diario: ${e.message}`, 'error'));
}, 10 * 60e3);

// Mientras n8n siga mandando gastos a cresova.com, después del corte se traen cada hora los nuevos (sin pisar nada).
setInterval(async () => {
  const key = process.env.CRESOVA_MCP_API_KEY?.trim();
  if (!state.cresovaCorte || !cdb.configurado() || !key) return;
  try {
    const r = await fetch('https://cresova.com/api/public/oficina-export?tabla=expenses', { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return; // el endpoint temporal ya se borró: n8n ya manda directo a la oficina
    const antes = (await cdb.q('select count(*)::int as n from expenses'))[0].n;
    await cdb.upsert('expenses', (await r.json()).filas || [], { soloNuevas: true });
    const nuevos = (await cdb.q('select count(*)::int as n from expenses'))[0].n - antes;
    if (nuevos > 0) log(null, `${nuevos} gasto(s) nuevos traídos de cresova.com (n8n todavía manda allá)`, 'info');
  } catch (e) { log(null, `No se pudieron traer los gastos nuevos de cresova.com: ${e.message}`, 'warn'); }
}, 60 * 60e3);

// Meta Conversions API: cada hora se reportan las cotizaciones nuevas (Lead) y las aceptadas (Purchase).
setInterval(async () => {
  if (!cdb.enUso()) return;
  try { const mm = await import('./cresova/meta-mensajeria.mjs'); await mm.barrer(); } catch {}
  try { const meta = await import('./cresova/meta.mjs'); await meta.barrer(); }
  catch (e) { log(null, `Meta CAPI: ${e.message}`, 'warn'); }
}, 60 * 60e3);

// Resumen semanal del negocio: los lunes a las 8:00 de Honduras, por WhatsApp a Diego.
setInterval(async () => {
  const d = new Date(Date.now() - 6 * 3600e3);
  const hoy = d.toISOString().slice(0, 10);
  // Desde el 9 nov va dentro de la página del CEO. Esto es el respaldo: a las 11:00 solo sale si el CEO no hizo su ronda.
  if (!cdb.enUso() || d.getUTCDay() !== 1 || d.getUTCHours() !== 11 || state.resumenSemanal === hoy || (state.ceo?.diario || []).some((x) => x.fecha === hoy)) return;
  state.resumenSemanal = hoy;
  try { const { resumenSemanal } = await import('./cresova/resumen.mjs'); await wa.messageOwner(await resumenSemanal()); log(null, 'Resumen semanal enviado a Diego', 'info'); }
  catch (e) { log(null, `No se pudo mandar el resumen semanal: ${e.message}`, 'warn'); }
}, 10 * 60e3);
