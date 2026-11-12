// Base propia de Cresova: Postgres en el VPS (servicio `cresova-db` de EasyPanel). Es la única fuente de
// cotizaciones, proyectos, pagos, clientes, tareas y tesorería. Las tablas copian 1 a 1 las de cresova.com
// (Lovable Cloud) para que la migración sea una copia y no una traducción.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { log, state, saveNow } from '../state.mjs';

export const ETAPAS = [
  { id: 'pending_demo', label: 'Pendiente demo' },
  { id: 'demo_sent', label: 'Demo enviada' },
  { id: 'approved', label: 'Aprobado' },
  { id: 'in_progress', label: 'En progreso' },
  { id: 'awaiting_approval', label: 'Esperando aprobación' },
  { id: 'finished', label: 'Terminado' },
  { id: 'delivered', label: 'Entregado' },
];
// Valores viejos del enum que el panel ya no muestra: se leen como su equivalente.
const NORMAL = { in_revisions: 'demo_sent', client_approved: 'approved' };
export const etapaDe = (s) => NORMAL[s] || (ETAPAS.some((e) => e.id === s) ? s : 'pending_demo');

// Las tablas que vienen de cresova.com, en el orden en que se copian.
export const TABLAS = ['org_settings', 'profiles', 'sellers', 'treasury_accounts', 'expense_categories', 'quote_products', 'clients', 'quotes', 'quote_items', 'quote_payments',
  'tasks', 'expenses', 'fixed_costs', 'treasury_transfers', 'payroll_payments', 'contract_templates', 'contract_clauses', 'contracts', 'contract_events', 'meta_ad_reports'];

export const configurado = () => Boolean(process.env.DATABASE_URL?.trim());
// "Corte": desde que Diego lo confirma, la base propia es la de verdad y cresova.com deja de usarse para esto.
// Antes del corte la base propia es una copia de prueba (cada sincronización la pisa) y el vendedor sigue usando el MCP.
export const enUso = () => configurado() && Boolean(state.cresovaCorte);
export function corte(on) { state.cresovaCorte = on ? Date.now() : null; saveNow(); log(null, on ? 'Corte hecho: la base propia de Cresova es la oficial' : 'Corte deshecho: se vuelve a usar cresova.com', on ? 'ok' : 'warn'); return state.cresovaCorte; }

let pool = null;
let listo = null;
function db() {
  if (!configurado()) throw new Error('Falta la conexión a la base de Cresova (Sistema → Llaves → Base de datos de Cresova).');
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.trim(), max: 5, idleTimeoutMillis: 30_000 });
    pool.on('error', (e) => log(null, `Base de Cresova: ${e.message}`, 'warn'));
  }
  // El esquema se aplica una vez por arranque (todo "if not exists").
  listo ||= pool.query(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8')).catch((e) => { listo = null; throw e; });
  return listo.then(() => pool);
}
export const q = async (sql, params = []) => (await (await db()).query(sql, params)).rows;
export async function transaccion(fn) {
  const c = await (await db()).connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
export function reiniciar() { if (pool) pool.end().catch(() => {}); pool = null; listo = null; }

export async function probar() {
  const [r] = await q('select count(*)::int as n from quotes');
  return r.n;
}

const SELECT = `select q.*, coalesce((select sum(amount) from quote_payments p where p.quote_id = q.id), 0)::float as pagado,
  (select name from quote_items i where i.quote_id = q.id order by sort_order, created_at limit 1) as paquete
  from quotes q`;

function armar(r) {
  const etapa = etapaDe(r.project_status);
  const fecha = (x) => (x ? new Date(x).toISOString() : null);
  const desde = etapa === 'pending_demo' ? r.created_at : etapa === 'demo_sent' ? r.sent_at || r.created_at : etapa === 'delivered' ? r.delivered_at || r.updated_at : r.accepted_at || r.updated_at || r.created_at;
  return {
    id: r.id, numero: r.quote_number, cliente: r.client_name, empresa: r.client_company, telefono: r.client_phone,
    estado: r.status, etapa, total: Number(r.total || 0), moneda: r.currency || 'HNL', pagado: Number(r.pagado || 0), paquete: r.paquete || '',
    demo: r.demo_url, brief: r.dev_brief, notas: r.notes, notasProyecto: r.project_notes, token: r.public_token,
    creada: fecha(r.created_at), enviada: fecha(r.sent_at), aceptada: fecha(r.accepted_at), entregada: fecha(r.delivered_at), desde: fecha(desde),
    dias: Math.max(0, Math.floor((Date.now() - new Date(desde || r.created_at).getTime()) / 86400e3)),
  };
}

// El tablero: todo lo no rechazado; los entregados solo del último mes y medio (o todos, si se piden).
export async function proyectos({ entregados = false } = {}) {
  const rows = await q(`${SELECT} where coalesce(q.status, '') <> 'rejected' order by q.created_at desc limit 400`);
  const corte = Date.now() - 45 * 86400e3;
  return rows.map(armar).filter((p) => p.estado !== 'expired' || p.pagado > 0)
    .filter((p) => p.etapa !== 'delivered' || entregados || Date.parse(p.entregada || p.creada) > corte);
}
export const porNumero = async (numero) => (await q(`${SELECT} where q.quote_number = $1 limit 1`, [String(numero)])).map(armar)[0] || null;
const porId = async (id) => (await q(`${SELECT} where q.id = $1 limit 1`, [id])).map(armar)[0] || null;

// Mover de etapa, con las mismas reglas que el panel de cresova.com: "Demo enviada" exige el enlace y deja la
// cotización enviada; de "Aprobado" en adelante queda aceptada; "Entregado" guarda la fecha.
export async function mover(id, etapa, { demoUrl = '', nota = '' } = {}) {
  if (!ETAPAS.some((e) => e.id === etapa)) throw new Error(`Etapa desconocida: ${etapa}`);
  const p = await porId(id);
  if (!p) throw new Error('Cotización no encontrada.');
  const set = { project_status: etapa, updated_at: new Date() };
  if (etapa === 'demo_sent') {
    const url = demoUrl || p.demo;
    if (!/^https?:\/\/\S+$/.test(String(url || ''))) throw new Error('Para "Demo enviada" hace falta el enlace de la demo.');
    set.demo_url = url;
    if (p.estado !== 'accepted') set.status = 'sent';
    if (!p.enviada) set.sent_at = new Date();
  }
  if (['approved', 'in_progress', 'awaiting_approval', 'finished', 'delivered'].includes(etapa) && p.estado !== 'accepted') { set.status = 'accepted'; if (!p.aceptada) set.accepted_at = new Date(); }
  if (etapa === 'delivered' && !p.entregada) set.delivered_at = new Date();
  if (nota) set.project_notes = `${p.notasProyecto ? `${p.notasProyecto}\n` : ''}${new Date().toISOString().slice(0, 10)}: ${String(nota).slice(0, 500)}`;
  const cols = Object.keys(set);
  await q(`update quotes set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => set[c])]);
  log('vendedor', `Proyecto ${p.numero} (${p.empresa || p.cliente}) → ${ETAPAS.find((e) => e.id === etapa).label}`, 'info');
  return porId(id);
}

export const demoEnviada = (numero, url) => porNumero(numero).then((p) => (p ? mover(p.id, 'demo_sent', { demoUrl: url }) : null));

// Resultado de la venta desde Ventas: ganada = aceptada (a "Aprobado" si no había pasado de la demo);
// perdida = rechazada con el motivo.
export async function resultado(numero, tipo, nota = '') {
  const p = await porNumero(numero);
  if (!p) return null;
  if (tipo === 'ganado') return mover(p.id, ['pending_demo', 'demo_sent'].includes(p.etapa) ? 'approved' : p.etapa);
  await q(`update quotes set status = 'rejected', responded_at = now(), updated_at = now(), motivo_no_cierre = coalesce($2, motivo_no_cierre) where id = $1`, [p.id, nota ? String(nota).slice(0, 300) : null]);
  log('vendedor', `Cotización ${p.numero} marcada como perdida${nota ? `: ${nota}` : ''}`, 'info');
  return porId(p.id);
}

export const cuentas = () => q('select id, name, holder, type from treasury_accounts where is_active order by name');

// Pago de una cotización (el 50 % para arrancar, el resto al entregar). Con el primer pago la cotización
// queda aceptada y el proyecto pasa a "Aprobado" si todavía estaba en demo.
export async function pago(id, { monto, metodo = 'transfer', fecha, cuenta = null, nota = '', referencia = '' } = {}) {
  const p = await porId(id);
  if (!p) throw new Error('Cotización no encontrada.');
  const amount = Number(monto);
  if (!(amount > 0)) throw new Error('El monto tiene que ser mayor que 0.');
  const paidAt = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || '')) ? fecha : new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
  await q(`insert into quote_payments (quote_id, client_id, amount, paid_at, method, treasury_account_id, notes, reference, source)
    select $1, client_id, $2, $3, $4, $5, $6, $7, 'oficina' from quotes where id = $1`, [id, amount, paidAt, metodo, cuenta || null, nota || null, referencia || null]);
  log('vendedor', `Pago de L ${amount.toLocaleString('en-US')} registrado en ${p.numero} (${p.empresa || p.cliente})`, 'ok');
  return mover(id, ['pending_demo', 'demo_sent'].includes(p.etapa) ? 'approved' : p.etapa);
}

// ---------- lo que crea el vendedor ----------
// Cliente + cotización en borrador (con su ítem) + tarea, como lo hacía el MCP de cresova.com.
// Número correlativo por año: COT-2026-0202.
// prueba: hace todo y lo deshace al final (para verificar sin dejar nada guardado).
export async function crearCaso({ nombre, empresa, telefono, rubro, paquete, precio = 0, descripcion = '', notas = '', prueba = false, sinTarea = false, fuente = 'whatsapp' }) {
  const pool = await db();
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('lock table quotes in share row exclusive mode');
    const anio = new Date(Date.now() - 6 * 3600e3).getUTCFullYear();
    const [{ n }] = (await c.query(`select coalesce(max(substring(quote_number from '\\d+$')::int), 0) + 1 as n from quotes where quote_number like $1`, [`COT-${anio}-%`])).rows;
    const numero = `COT-${anio}-${String(n).padStart(4, '0')}`;
    const [cli] = (await c.query(`insert into clients (name, business_name, phone, sector, service, notes, status, source, telefono_normalizado, fecha_primer_contacto)
      values ($1, $2, $3, $4, $5, $6, 'lead', $8, $7, current_date) returning id`, [nombre, empresa || null, telefono, rubro || null, paquete, notas, String(telefono || '').replace(/\D/g, ''), fuente])).rows;
    const [cot] = (await c.query(`insert into quotes (quote_number, client_id, client_name, client_company, client_phone, status, project_status, subtotal, subtotal_setup, total, total_hnl, currency, notes, valid_until)
      values ($1, $2, $3, $4, $5, 'draft', 'pending_demo', $6, $6, $6, $6, 'HNL', $7, current_date + 15) returning id`, [numero, cli.id, nombre, empresa || null, telefono, Number(precio) || 0, notas])).rows;
    await c.query(`insert into quote_items (quote_id, name, description, unit_price, quantity, subtotal, list_price, billing) values ($1, $2, $3, $4, 1, $4, $4, 'one_time')`, [cot.id, paquete, descripcion || null, Number(precio) || 0]);
    if (!sinTarea) await c.query(`insert into tasks (title, notes, client_id, quote_id, category, status, priority, source) values ($1, $2, $3, $4, 'seguimiento_ventas', 'pending', 'high', 'oficina')`,
      [`Armar y enviar la demo de ${empresa || telefono}`, notas, cli.id, cot.id]);
    if (prueba) { await c.query('rollback'); return { numero, id: cot.id, cliente: cli.id, prueba: true }; }
    await c.query('commit');
    log('vendedor', `Cotización ${numero} creada en la base de Cresova (${empresa || nombre})`, 'ok');
    return { numero, id: cot.id, cliente: cli.id };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

// ---------- copia desde cresova.com ----------
// Inserta o actualiza filas tal cual vienen de la base de Lovable (mismas columnas). Las columnas que no
// existen acá se ignoran; arrays y JSON se pasan como vienen.
const columnasDe = new Map();
async function columnas(tabla) {
  if (!columnasDe.has(tabla)) {
    const rows = await q(`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`, [tabla]);
    columnasDe.set(tabla, new Map(rows.map((r) => [r.column_name, r.data_type])));
  }
  return columnasDe.get(tabla);
}
// soloNuevas: después del corte, lo que llega de cresova.com nunca pisa lo que ya está acá (solo se agregan filas nuevas).
export async function upsert(tabla, filas, { soloNuevas = false } = {}) {
  if (!TABLAS.includes(tabla)) throw new Error(`Tabla no permitida: ${tabla}`);
  if (!Array.isArray(filas) || !filas.length) return 0;
  const cols = await columnas(tabla);
  const usar = [...cols.keys()].filter((c) => filas.some((f) => c in f));
  if (!usar.includes('id')) throw new Error(`${tabla}: las filas no traen id`);
  const client = await (await db()).connect();
  try {
    await client.query('begin');
    for (const f of filas) {
      const vals = usar.map((c) => {
        const v = f[c];
        if (v == null) return null;
        return cols.get(c) === 'jsonb' ? JSON.stringify(v) : v;
      });
      await client.query(`insert into ${tabla} (${usar.join(', ')}) values (${usar.map((_, i) => `$${i + 1}`).join(', ')})
        on conflict (id) do ${soloNuevas ? 'nothing' : `update set ${usar.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`}`, vals);
    }
    await client.query(`insert into _sincronizacion (tabla, filas, ts) values ($1, $2, now()) on conflict (tabla) do update set filas = excluded.filas, ts = now()`, [tabla, filas.length]);
    await client.query('commit');
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  return filas.length;
}

export async function conteos() {
  const out = {};
  for (const t of TABLAS) out[t] = (await q(`select count(*)::int as n from ${t}`))[0].n;
  const [m] = await q(`select (select round(coalesce(sum(amount), 0), 2) from quote_payments)::text as pagos, (select round(coalesce(sum(amount), 0), 2) from expenses)::text as gastos,
    (select round(coalesce(sum(total), 0), 2) from quotes)::text as cotizado`);
  return { tablas: out, montos: m, ultima: await q('select tabla, filas, ts from _sincronizacion order by tabla'), corte: state.cresovaCorte || null };
}

// ---------- respaldo diario ----------
// Una copia en JSON de todas las tablas en /data/respaldos (se guardan las últimas 14). Si se configura un
// destino S3 en EasyPanel, ese respaldo es mejor; este es el piso.
export async function respaldar(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const datos = {};
  for (const t of TABLAS) datos[t] = await q(`select * from ${t}`);
  const archivo = path.join(dir, `cresova-${new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(archivo, JSON.stringify(datos));
  const viejos = fs.readdirSync(dir).filter((f) => /^cresova-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
  for (const f of viejos) fs.rmSync(path.join(dir, f), { force: true });
  return { archivo: path.basename(archivo), kb: Math.round(fs.statSync(archivo).size / 1024) };
}
