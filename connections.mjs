// Conexiones MCP de los agentes: lectura de la configuración y comprobación
// real de que cada servicio acepta la llave (sin exponer ningún secreto).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './state.mjs';
import { SERVICES } from './agents.mjs';

// data/mcp.json (o mcp.example.json): { "cresova": { "type": "http", "url": "...", "headers": {...} } }
// Los valores pueden usar ${VARIABLE}.
function readTemplates() {
  let file = path.join(DATA_DIR, 'mcp.json');
  if (!fs.existsSync(file)) file = path.join(import.meta.dirname, 'mcp.example.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const varsOf = (cfg) => [...JSON.stringify(cfg).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
const isSet = (name) => Boolean(process.env[name]?.trim());

// Servidores con todas sus variables definidas, ya con los valores puestos.
// Un servidor con variables vacías se omite: el agente lo ve "sin conexión".
export function loadMcpConfig() {
  const out = {};
  for (const [name, cfg] of Object.entries(readTemplates())) {
    if (!varsOf(cfg).every(isSet)) continue;
    out[name] = JSON.parse(
      JSON.stringify(cfg).replace(/\$\{(\w+)\}/g, (_, k) => JSON.stringify(process.env[k].trim()).slice(1, -1)),
    );
  }
  return out;
}

const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

async function probe(id, cfg) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...cfg.headers };
  const post = (body) => fetch(cfg.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
  try {
    const res = await post(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oficina', version: '1' } }));
    if (res.status === 401 || res.status === 403) return { state: 'invalid', detail: 'El servicio rechazó la llave' };
    if (!res.ok) return { state: 'unreachable', detail: `Respondió HTTP ${res.status}` };
    // El MCP de Cresova acepta la conexión sin llave, así que se valida con su propia herramienta.
    if (id === 'cresova') {
      const text = await (await post(rpc(2, 'tools/call', { name: 'check_api_key', arguments: {} }))).text();
      if (!/valid\\?"\s*:\s*true/.test(text)) return { state: 'invalid', detail: 'Cresova no reconoce esta llave' };
    }
    return { state: 'ok' };
  } catch (err) {
    return { state: 'unreachable', detail: err.name === 'TimeoutError' ? 'Sin respuesta a tiempo' : err.message.slice(0, 80) };
  }
}

let cache = { at: 0, data: null };

export async function connectionStatus({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.at < 60_000) return cache.data;
  const resolved = loadMcpConfig();
  const data = await Promise.all(Object.entries(readTemplates()).map(async ([id, cfg]) => {
    const vars = varsOf(cfg);
    const missing = vars.filter((v) => !isSet(v));
    const base = { id, label: SERVICES[id] || id, missing };
    return missing.length ? { ...base, state: 'missing' } : { ...base, ...(await probe(id, resolved[id])) };
  }));
  cache = { at: Date.now(), data };
  return data;
}

export function claudeCredential() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return 'suscripción';
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'API key';
  return null;
}

// Llama una herramienta de un servidor MCP por HTTP, para el código de la oficina.
// Primero sin sesión (lo aceptan Cresova y otros); si el servidor exige inicializar ("Server not initialized", como Upload-Post),
// hace el saludo inicial (initialize + notifications/initialized) y repite la llamada con la sesión.
export async function callMcpTool(server, name, args = {}) {
  const cfg = loadMcpConfig()[server];
  if (!cfg) throw new Error(`Falta la conexión ${server}.`);
  const parse = async (res) => {
    let text = await res.text();
    const sse = text.match(/^data: (.+)$/m);
    if (sse) text = sse[1];
    try { return JSON.parse(text); } catch { return { error: { message: `Respuesta inesperada (HTTP ${res.status}): ${text.slice(0, 120)}` } }; }
  };
  const post = async (headers, body) => fetch(cfg.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30_000) });
  const base = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...cfg.headers };
  let j = await parse(await post(base, rpc(Date.now(), 'tools/call', { name, arguments: args })));
  if (j.error && /not initialized|initialize/i.test(j.error.message || '')) {
    const ini = await post(base, rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oficina', version: '1' } }));
    const sid = ini.headers.get('mcp-session-id');
    await ini.text().catch(() => {});
    const headers = { ...base, ...(sid ? { 'Mcp-Session-Id': sid } : {}) };
    await post(headers, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })).then((r) => r.text()).catch(() => {});
    j = await parse(await post(headers, rpc(Date.now(), 'tools/call', { name, arguments: args })));
  }
  if (j.error) throw new Error(j.error.message || 'Error del MCP');
  const out = j.result?.content?.map((c) => c.text).join('\n') || '';
  if (j.result?.isError) throw new Error(out.slice(0, 300));
  try { return JSON.parse(out); } catch { return out; }
}

// Prueba real de Meta: lista las herramientas y lee las cuentas publicitarias que ve el token (solo lectura).
export async function probarMeta() {
  const cfg = loadMcpConfig().metaads;
  if (!cfg) return { ok: false, error: 'Falta la llave de Meta.' };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...cfg.headers };
  const call = async (id, method, params) => {
    const res = await fetch(cfg.url, { method: 'POST', headers, body: rpc(id, method, params), signal: AbortSignal.timeout(30000) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) headers['Mcp-Session-Id'] = sid;
    const text = await res.text();
    const json = text.trim().startsWith('{') ? text : (text.match(/^data: (.+)$/m) || [])[1];
    return { status: res.status, body: json ? JSON.parse(json) : text.slice(0, 300) };
  };
  await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'oficina', version: '1' } });
  const tools = await call(2, 'tools/list', {});
  const names = (tools.body?.result?.tools || []).map((t) => t.name);
  const cuentas = names.includes('ads_get_ad_accounts') ? await call(3, 'tools/call', { name: 'ads_get_ad_accounts', arguments: {} }) : null;
  const txt = cuentas?.body?.result?.content?.map((c) => c.text).join('\n') || JSON.stringify(cuentas?.body?.error || tools.body?.error || '').slice(0, 400);
  return { ok: names.length > 0, herramientas: names.length, cuentas: txt.slice(0, 1500) };
}
