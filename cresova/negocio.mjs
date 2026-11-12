// Módulos de negocio de la oficina (los que antes estaban en cresova.com/app): cotizaciones, tesorería,
// clientes, pendientes y analíticas. Todo sobre la base propia (cresova/db.mjs). Los cálculos copian los
// de cresova.com: los montos en lempiras salen de total_hnl / amount_hnl; los pagos de clientes son ingresos;
// el dinero administrado de anuncios de clientes (ads_clients) no cuenta como gasto de Cresova.
import { q, transaccion, ETAPAS } from './db.mjs';
import { log } from '../state.mjs';

const num = (v) => Number(v || 0);
const hoyHn = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const ESTADOS = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

// ---------- cotizaciones ----------
export async function cotizaciones({ estado = 'all', buscar = '' } = {}) {
  const filas = await q(`select q.id, q.quote_number, q.client_name, q.client_company, q.client_phone, q.status, q.project_status, q.total, q.total_hnl, q.currency,
      q.created_at, q.accepted_at, q.sent_at, q.updated_at, q.public_token, q.seller_id, s.display_name as vendedor,
      coalesce((select sum(amount) from quote_payments p where p.quote_id = q.id), 0)::float as pagado,
      coalesce((select sum(unit_price * coalesce(quantity, 1)) from quote_items i where i.quote_id = q.id and i.billing = 'monthly'), 0)::float as mensual
    from quotes q left join sellers s on s.id = q.seller_id order by q.created_at desc`);
  const todas = filas.map((r) => ({ ...r, total: num(r.total), total_hnl: num(r.total_hnl ?? r.total) || num(r.total), saldo: Math.max(0, (num(r.total_hnl) || num(r.total)) - r.pagado) }));
  const b = String(buscar || '').trim().toLowerCase();
  const lista = todas.filter((r) => (estado === 'all' || r.status === estado)
    && (!b || `${r.client_name} ${r.client_company} ${r.quote_number}`.toLowerCase().includes(b)));
  return { lista, kpis: await kpisCotizaciones(todas), porEstado: Object.fromEntries(ESTADOS.map((e) => [e, todas.filter((r) => r.status === e).length])) };
}

async function kpisCotizaciones(todas) {
  const ahora = new Date(Date.now() - 6 * 3600e3);
  const inicioMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).getTime() + 6 * 3600e3;
  const inicioMesAnt = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1)).getTime() + 6 * 3600e3;
  const fechaAcept = (r) => new Date(r.accepted_at || r.updated_at || r.created_at).getTime();
  const enviadas = todas.filter((r) => r.status === 'sent');
  const aceptadas = todas.filter((r) => r.status === 'accepted');
  const rechazadas = todas.filter((r) => r.status === 'rejected');
  const esteMes = aceptadas.filter((r) => fechaAcept(r) >= inicioMes);
  const mesPasado = aceptadas.filter((r) => fechaAcept(r) >= inicioMesAnt && fechaAcept(r) < inicioMes);
  const suma = (l) => l.reduce((a, r) => a + r.total_hnl, 0);
  const [pg] = await q(`select coalesce(sum(amount), 0)::float as total, coalesce(sum(amount) filter (where paid_at >= date_trunc('month', (now() - interval '6 hours'))::date), 0)::float as mes from quote_payments`);
  const decididas = aceptadas.length + rechazadas.length;
  const aprobMes = suma(esteMes), aprobAnt = suma(mesPasado);
  return {
    pendientes: { monto: suma(enviadas), n: enviadas.length },
    aprobadoMes: { monto: aprobMes, n: esteMes.length, anterior: aprobAnt, nAnterior: mesPasado.length, delta: aprobAnt > 0 ? Math.round(((aprobMes - aprobAnt) / aprobAnt) * 100) : (aprobMes > 0 ? 100 : 0) },
    recurrente: aceptadas.reduce((a, r) => a + r.mensual, 0),
    cierre: { pct: decididas ? Math.round((aceptadas.length / decididas) * 100) : 0, aceptadas: aceptadas.length, decididas },
    cobrado: pg.total, cobradoMes: pg.mes,
    porCobrar: Math.max(0, suma(aceptadas) - aceptadas.reduce((a, r) => a + r.pagado, 0)),
    pipeline: {
      borrador: { monto: suma(todas.filter((r) => r.status === 'draft')), n: todas.filter((r) => r.status === 'draft').length },
      enviadas: { monto: suma(enviadas), n: enviadas.length },
      aceptadasMes: { monto: aprobMes, n: esteMes.length },
    },
  };
}

export async function cotizacion(id) {
  const [c] = await q(`select q.*, s.display_name as vendedor from quotes q left join sellers s on s.id = q.seller_id where q.id = $1`, [id]);
  if (!c) return null;
  const items = await q('select * from quote_items where quote_id = $1 order by sort_order, created_at', [id]);
  const pagos = await q(`select p.*, a.name as cuenta from quote_payments p left join treasury_accounts a on a.id = p.treasury_account_id where p.quote_id = $1 order by p.paid_at, p.created_at`, [id]);
  const cliente = c.client_id ? (await q('select id, name, business_name, phone, email, sector, rtn from clients where id = $1', [c.client_id]))[0] || null : null;
  const pagado = pagos.reduce((a, p) => a + num(p.amount), 0);
  return { ...c, items, pagos, cliente, pagado, saldo: Math.max(0, (num(c.total_hnl) || num(c.total)) - pagado) };
}

// Totales como el cotizador de cresova.com: el total del proyecto son los ítems de pago único (menos descuento,
// más ISV si aplica); lo mensual y anual se muestran aparte.
export function totales(items, { discount_type = 'percent', discount_value = 0, tax_enabled = false, tax_rate = 15 } = {}) {
  const sub = (b) => items.filter((i) => (i.billing || 'one_time') === b).reduce((a, i) => a + num(i.unit_price) * num(i.quantity ?? 1), 0);
  const setup = sub('one_time');
  const desc = discount_type === 'amount' ? num(discount_value) : setup * (num(discount_value) / 100);
  const base = Math.max(0, setup - desc);
  const isv = tax_enabled ? base * (num(tax_rate) / 100) : 0;
  return { subtotal: setup, subtotal_setup: setup, subtotal_monthly: sub('monthly'), subtotal_yearly: sub('yearly'), tax_amount: isv, total: Math.max(0, base + isv) };
}

const CAMPOS_COT = ['client_name', 'client_company', 'client_phone', 'client_email', 'client_rtn', 'client_contact_name', 'client_contact_role', 'notes', 'valid_until',
  'discount_type', 'discount_value', 'tax_enabled', 'tax_rate', 'currency', 'fx_rate', 'dev_brief', 'seller_id', 'client_id', 'paquete_resumen', 'is_enterprise', 'enterprise_data'];

// Crear o guardar una cotización completa (encabezado + ítems), en una transacción.
export async function guardarCotizacion(id, datos) {
  const items = (Array.isArray(datos.items) ? datos.items : []).filter((i) => String(i.name || '').trim()).map((i, k) => ({
    product_id: i.product_id || null, name: String(i.name).trim().slice(0, 300), description: i.description ? String(i.description).slice(0, 4000) : null,
    unit_price: num(i.unit_price), quantity: num(i.quantity ?? 1) || 1, billing: ['monthly', 'yearly'].includes(i.billing) ? i.billing : 'one_time',
    list_price: num(i.list_price), discount_pct: num(i.discount_pct), is_recommended: Boolean(i.is_recommended), sort_order: k,
  }));
  if (!items.length) throw new Error('La cotización necesita al menos un concepto.');
  if (!String(datos.client_name || '').trim()) throw new Error('Falta el nombre del cliente.');
  const t = totales(items, datos);
  const fx = num(datos.fx_rate) || 1;
  const cab = Object.fromEntries(CAMPOS_COT.filter((k) => k in datos).map((k) => [k, datos[k] === '' ? null : datos[k]]));
  Object.assign(cab, t, { total_hnl: (datos.currency || 'HNL') === 'HNL' ? t.total : t.total * fx, updated_at: new Date() });
  return transaccion(async (c) => {
    if (!id) {
      const anio = new Date(Date.now() - 6 * 3600e3).getUTCFullYear();
      await c.query('lock table quotes in share row exclusive mode');
      const [{ n }] = (await c.query(`select coalesce(max(substring(quote_number from '\\d+$')::int), 0) + 1 as n from quotes where quote_number like $1`, [`COT-${anio}-%`])).rows;
      Object.assign(cab, { quote_number: `COT-${anio}-${String(n).padStart(4, '0')}`, status: 'draft', project_status: 'pending_demo', valid_until: cab.valid_until || null });
    }
    const cols = Object.keys(cab);
    const vals = cols.map((k) => cab[k]);
    const fila = id
      ? (await c.query(`update quotes set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning id, quote_number`, [id, ...vals])).rows[0]
      : (await c.query(`insert into quotes (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, quote_number`, vals)).rows[0];
    if (!fila) throw new Error('Cotización no encontrada.');
    await c.query('delete from quote_items where quote_id = $1', [fila.id]);
    for (const i of items) {
      await c.query(`insert into quote_items (quote_id, product_id, name, description, unit_price, quantity, subtotal, billing, list_price, discount_pct, is_recommended, sort_order)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [fila.id, i.product_id, i.name, i.description, i.unit_price, i.quantity, i.unit_price * i.quantity, i.billing, i.list_price, i.discount_pct, i.is_recommended, i.sort_order]);
    }
    log(null, `Cotización ${fila.quote_number} ${id ? 'actualizada' : 'creada'} desde la oficina`, 'info');
    return fila;
  });
}

// Estado comercial: enviada guarda la fecha; aceptada guarda la fecha y pasa el proyecto a "Aprobado" si seguía en demo.
export async function estadoCotizacion(id, estado) {
  if (!ESTADOS.includes(estado)) throw new Error('Estado inválido.');
  const [c] = await q('select status, project_status, sent_at, accepted_at from quotes where id = $1', [id]);
  if (!c) throw new Error('Cotización no encontrada.');
  const set = { status: estado, updated_at: new Date() };
  if (estado === 'sent' && !c.sent_at) set.sent_at = new Date();
  if (estado === 'accepted') { if (!c.accepted_at) set.accepted_at = new Date(); if (['pending_demo', 'demo_sent', null].includes(c.project_status)) set.project_status = 'approved'; }
  if (['accepted', 'rejected'].includes(estado)) set.responded_at = new Date();
  const cols = Object.keys(set);
  await q(`update quotes set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((k) => set[k])]);
  return cotizacion(id);
}

// Copia en borrador, con vigencia nueva. No cuenta como un cliente nuevo para Meta.
export async function duplicarCotizacion(id) {
  const c = await cotizacion(id);
  if (!c) throw new Error('Cotización no encontrada.');
  const datos = Object.fromEntries(CAMPOS_COT.map((k) => [k, c[k]]));
  datos.valid_until = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  datos.items = c.items;
  const r = await guardarCotizacion(null, datos);
  await q('update quotes set meta_lead_sent_at = now() where id = $1', [r.id]);
  return r;
}

export async function borrarCotizacion(id) {
  const [c] = await q('select quote_number from quotes where id = $1', [id]);
  if (!c) throw new Error('Cotización no encontrada.');
  await q('delete from quote_payments where quote_id = $1', [id]);
  await q('delete from quote_items where quote_id = $1', [id]);
  await q('delete from quotes where id = $1', [id]);
  log(null, `Cotización ${c.quote_number} eliminada desde la oficina`, 'warn');
  return { ok: true };
}

export async function borrarPago(id) { await q('delete from quote_payments where id = $1', [id]); return { ok: true }; }
export const productos = () => q('select * from quote_products where is_active order by sort_order, name');
export const vendedores = () => q('select id, display_name from sellers where is_active order by display_name');

// ---------- tesorería ----------
export async function tesoreria({ desde, hasta } = {}) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : hoyHn().slice(0, 8) + '01';
  const h = /^\d{4}-\d{2}-\d{2}$/.test(hasta || '') ? hasta : hoyHn();
  const [r] = await q(`select
      (select coalesce(sum(amount), 0) from quote_payments where paid_at between $1 and $2)::float as ingresos,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e left join expense_categories c on c.id = e.category_id where e.status = 'paid' and coalesce(e.paid_at, e.expense_date) between $1 and $2 and coalesce(c.key, '') <> 'ads_clients')::float as gastos,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e left join expense_categories c on c.id = e.category_id where e.status = 'pending' and coalesce(c.key, '') <> 'ads_clients')::float as por_pagar,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e join expense_categories c on c.id = e.category_id where c.key = 'ads_cresova' and e.status = 'paid' and coalesce(e.paid_at, e.expense_date) between $1 and $2)::float as publicidad,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e join expense_categories c on c.id = e.category_id where c.key = 'ads_clients' and coalesce(e.paid_at, e.expense_date) between $1 and $2)::float as administrado,
      (select coalesce(sum(greatest(coalesce(q.total_hnl, q.total) - coalesce(p.pagado, 0), 0)), 0) from quotes q left join (select quote_id, sum(amount) as pagado from quote_payments group by quote_id) p on p.quote_id = q.id where q.status in ('accepted', 'signed'))::float as por_cobrar`, [d, h]);
  const cuentas = await q(`select a.id, a.name, a.holder, a.type,
      (coalesce((select sum(amount) from quote_payments where treasury_account_id = a.id), 0)
       - coalesce((select sum(amount_hnl) from expenses where account_id = a.id and status = 'paid'), 0)
       + coalesce((select sum(amount) from treasury_transfers where to_account_id = a.id), 0)
       - coalesce((select sum(amount) from treasury_transfers where from_account_id = a.id), 0))::float as saldo
    from treasury_accounts a where a.is_active order by a.name`);
  const meses = await q(`with m as (select generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month')::date as mes)
    select to_char(m.mes, 'YYYY-MM') as mes,
      coalesce((select sum(amount) from quote_payments where date_trunc('month', paid_at) = m.mes), 0)::float as ingresos,
      coalesce((select sum(amount_hnl) from expenses where status = 'paid' and coalesce(expense_type, '') <> 'client_managed' and date_trunc('month', coalesce(paid_at, expense_date)) = m.mes), 0)::float as gastos
    from m order by m.mes`);
  const [sinCuenta] = await q('select count(*)::int as n, coalesce(sum(amount), 0)::float as monto from quote_payments where treasury_account_id is null');
  const [sinCat] = await q('select count(*)::int as n from expenses where category_id is null');
  const porCategoria = await q(`select coalesce(c.label, 'Sin categoría') as categoria, sum(e.amount_hnl)::float as monto, count(*)::int as n from expenses e left join expense_categories c on c.id = e.category_id
    where e.status = 'paid' and coalesce(e.paid_at, e.expense_date) between $1 and $2 and coalesce(c.key, '') <> 'ads_clients' group by 1 order by 2 desc`, [d, h]);
  const proximos = await q(`select id, expense_date, amount, amount_hnl, currency, description, vendor from expenses where status = 'pending' order by expense_date limit 8`);
  return { desde: d, hasta: h, ...r, utilidad: r.ingresos - r.gastos, saldo: cuentas.reduce((a, c) => a + c.saldo, 0), cuentas, meses, sinCuenta, sinCategoria: sinCat.n, porCategoria, proximos };
}

export async function gastos({ desde, hasta, categoria = '', estado = '', buscar = '', sinCategoria = false } = {}) {
  const cond = [], p = [];
  const add = (sql, v) => { p.push(v); cond.push(sql.replace('?', `$${p.length}`)); };
  if (desde) add('coalesce(e.paid_at, e.expense_date) >= ?', desde);
  if (hasta) add('coalesce(e.paid_at, e.expense_date) <= ?', hasta);
  if (categoria) add('e.category_id = ?', categoria);
  if (estado) add('e.status = ?', estado);
  if (sinCategoria) cond.push('e.category_id is null');
  if (buscar) { p.push(`%${buscar}%`); cond.push(`(e.description ilike $${p.length} or e.vendor ilike $${p.length})`); }
  return q(`select e.*, c.label as categoria, c.key as categoria_key, a.name as cuenta, qq.quote_number from expenses e left join expense_categories c on c.id = e.category_id
    left join treasury_accounts a on a.id = e.account_id left join quotes qq on qq.id = e.quote_id
    ${cond.length ? `where ${cond.join(' and ')}` : ''} order by coalesce(e.paid_at, e.expense_date) desc, e.created_at desc limit 500`, p);
}

const CAMPOS_GASTO = ['expense_date', 'amount', 'currency', 'fx_rate', 'vendor', 'description', 'category_id', 'expense_type', 'status', 'payment_method', 'account_id', 'paid_at', 'quote_id', 'notes'];
export async function guardarGasto(id, datos) {
  const g = Object.fromEntries(CAMPOS_GASTO.filter((k) => k in datos).map((k) => [k, datos[k] === '' ? null : datos[k]]));
  // Gasto personal de Diego: va a su nómina como adelanto.
  if (!id && esPersonal(g.vendor) && !g.category_id) { g.category_id = await categoriaNomina(); g.notes ||= NOTA_PERSONAL; }
  if (!id && !(num(g.amount) > 0)) throw new Error('El monto tiene que ser mayor que 0.');
  if ('amount' in g || 'fx_rate' in g || 'currency' in g) {
    const [prev] = id ? await q('select amount, currency, fx_rate from expenses where id = $1', [id]) : [{}];
    const m = num(g.amount ?? prev?.amount), cur = g.currency ?? prev?.currency ?? 'HNL', fx = num(g.fx_rate ?? prev?.fx_rate) || 1;
    g.amount_hnl = cur === 'HNL' ? m : m * fx;
  }
  if (g.status === 'paid' && !g.paid_at && !id) g.paid_at = g.expense_date || hoyHn();
  if (!id) { g.expense_date ||= hoyHn(); g.currency ||= 'HNL'; g.status ||= 'paid'; g.source = 'oficina'; g.expense_type ||= 'operating'; }
  g.updated_at = new Date();
  const cols = Object.keys(g);
  const [fila] = id
    ? await q(`update expenses set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning id`, [id, ...cols.map((k) => g[k])])
    : await q(`insert into expenses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, cols.map((k) => g[k]));
  return fila;
}
export async function borrarGasto(id) { await q('delete from expenses where id = $1', [id]); return { ok: true }; }
export const categorias = () => q('select id, key, label from expense_categories where is_active order by sort_order, label');

// ---------- Gastos personales y retiros de Diego: se descuentan de su nómina ----------
export const NOTA_PERSONAL = 'Gasto personal de Diego: se descuenta de su nómina.';
export const esPersonal = (v) => /^\s*personal\s*$/i.test(String(v || ''));
export async function categoriaNomina() { const [c] = await q("select id from expense_categories where key = 'payroll' limit 1"); return c?.id || null; }
export async function personalesANomina() {
  const cat = await categoriaNomina();
  if (!cat) return 0;
  const r = await q(`update expenses set category_id = $1, notes = case when coalesce(notes, '') = '' then $2 else notes || ' · ' || $2 end, updated_at = now()
    where category_id is null and lower(trim(coalesce(vendor, ''))) = 'personal' returning id`, [cat, NOTA_PERSONAL]);
  if (r.length) log(null, `${r.length} gastos personales pasados a la nómina de Diego`, 'info');
  return r.length;
}
export async function registrarRetiro({ monto, fecha, cuenta, nota }) {
  if (!(num(monto) > 0)) throw new Error('El monto tiene que ser mayor que 0.');
  return guardarGasto(null, { amount: num(monto), expense_date: fecha || hoyHn(), account_id: cuenta || null, vendor: 'Personal', description: String(nota || '').trim() || 'Retiro de Diego', status: 'paid', payment_method: 'transfer' });
}
export async function personalesDiego({ meses = 6 } = {}) {
  const per = await q(`select to_char(date_trunc('month', coalesce(paid_at, expense_date)), 'YYYY-MM') as mes, count(*)::int as n, coalesce(sum(amount_hnl), 0)::float as monto
    from expenses where lower(trim(coalesce(vendor, ''))) = 'personal' and coalesce(paid_at, expense_date) >= date_trunc('month', current_date) - ($1::int - 1) * interval '1 month' group by 1`, [meses]);
  const nom = await q(`select to_char(date_trunc('month', p.period_month), 'YYYY-MM') as mes, coalesce(sum(p.total_amount), 0)::float as monto
    from payroll_payments p join sellers s on s.id = p.seller_id where s.display_name ilike 'diego%' and p.period_month >= date_trunc('month', current_date) - ($1::int - 1) * interval '1 month' group by 1`, [meses]);
  const recientes = await q(`select e.id, coalesce(e.paid_at, e.expense_date) as fecha, e.description, e.amount_hnl::float as monto, a.name as cuenta from expenses e left join treasury_accounts a on a.id = e.account_id
    where lower(trim(coalesce(e.vendor, ''))) = 'personal' order by coalesce(e.paid_at, e.expense_date) desc, e.created_at desc limit 15`);
  const lista = [];
  for (let i = 0; i < meses; i++) {
    const d = new Date(Date.now() - 6 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
    const k = d.toISOString().slice(0, 7);
    const p = per.find((x) => x.mes === k), n = nom.find((x) => x.mes === k);
    lista.push({ mes: k, nomina: n?.monto || 0, personales: p?.monto || 0, n: p?.n || 0 });
  }
  return { meses: lista, recientes };
}
setTimeout(() => personalesANomina().catch(() => {}), 60_000);
setInterval(() => personalesANomina().catch(() => {}), 3600e3);

// Gastos sin categoría: se sugiere la categoría que ya usaste con ese proveedor o, si no hay historia, por palabras clave.
// Nada se cambia hasta que Diego toca "Aplicar".
const CLAVES = [[/facebk|facebook|meta ads|\bmeta\b/i, 'ads_cresova'], [/lovable/i, 'lovable_credits'], [/hostinger|vercel|digitalocean|aws|easypanel|hetzner|netlify/i, 'hosting'], [/anthropic|claude|openai|openrouter|elevenlabs|higgsfield|canva|notion|gemini|google one|upload.?post|ycloud/i, 'software'], [/namecheap|godaddy|dominio|domain/i, 'domains'], [/comisi[oó]n bancaria|cargo bancario|bank fee/i, 'bank_fees']];
export async function sugerenciasGastos() {
  const cats = await categorias();
  const porKey = Object.fromEntries(cats.map((c) => [c.key, c]));
  const hechos = await q("select lower(trim(coalesce(vendor, ''))) as v, category_id, count(*)::int as n from expenses where category_id is not null group by 1, 2");
  const historia = {};
  for (const r of hechos) (historia[r.v] ||= []).push(r);
  const sin = await q("select id, vendor, description, amount_hnl::float as monto from expenses where category_id is null order by coalesce(paid_at, expense_date) desc");
  const grupos = {}, nada = { n: 0, monto: 0, personales: 0, ejemplos: [] };
  for (const g of sin) {
    const v = String(g.vendor || '').trim().toLowerCase();
    let cat = null, motivo = '';
    const h = (historia[v] || []).sort((a, b) => b.n - a.n);
    const total = h.reduce((s, r) => s + r.n, 0);
    if (v && v !== 'personal' && h[0] && h[0].n >= 2 && h[0].n / total >= 0.7) { cat = cats.find((c) => c.id === h[0].category_id); motivo = `como tus otros ${h[0].n} gastos de ${g.vendor}`; }
    if (!cat && v !== 'personal') { const k = CLAVES.find(([re]) => re.test(`${g.vendor || ''} ${g.description || ''}`)); if (k && porKey[k[1]]) { cat = porKey[k[1]]; motivo = 'por el nombre del cobro'; } }
    if (!cat) { nada.n++; nada.monto += g.monto || 0; if (v === 'personal') nada.personales++; if (nada.ejemplos.length < 6) nada.ejemplos.push(String(g.description || g.vendor || '').replace(/\s*\[ref:[^\]]*\]/, '').replace(/\s{2,}.*/, '').slice(0, 40)); continue; }
    const x = (grupos[cat.id] ||= { category_id: cat.id, label: cat.label, n: 0, monto: 0, ids: [], proveedores: new Set(), motivo });
    x.n++; x.monto += g.monto || 0; x.ids.push(g.id); if (g.vendor) x.proveedores.add(g.vendor);
  }
  return { grupos: Object.values(grupos).map((x) => ({ ...x, monto: Math.round(x.monto), proveedores: [...x.proveedores].slice(0, 4) })).sort((a, b) => b.n - a.n), sinSugerencia: { ...nada, monto: Math.round(nada.monto) } };
}
export async function categorizarGastos(ids, categoryId) {
  if (!Array.isArray(ids) || !ids.length || !categoryId) throw new Error('Faltan los gastos o la categoría.');
  const r = await q('update expenses set category_id = $1, updated_at = now() where id = any($2::uuid[]) and category_id is null returning id', [categoryId, ids.slice(0, 500)]);
  return { ok: true, actualizados: r.length };
}
export const costosFijos = () => q(`select f.*, c.label as categoria, a.name as cuenta from fixed_costs f left join expense_categories c on c.id = f.category_id left join treasury_accounts a on a.id = f.account_id where f.is_active order by f.due_day nulls last, f.name`);
export const transferencias = () => q(`select t.*, a.name as desde, b.name as hacia from treasury_transfers t left join treasury_accounts a on a.id = t.from_account_id left join treasury_accounts b on b.id = t.to_account_id order by t.transfer_date desc limit 100`);
export const planilla = () => q(`select p.*, s.display_name as vendedor, a.name as cuenta from payroll_payments p left join sellers s on s.id = p.seller_id left join treasury_accounts a on a.id = p.treasury_account_id order by p.period_month desc, s.display_name limit 200`);
export async function pagosSinCuenta() {
  return q(`select p.id, p.amount, p.paid_at, p.method, q.quote_number, q.client_company, q.client_name from quote_payments p join quotes q on q.id = p.quote_id where p.treasury_account_id is null order by p.paid_at desc`);
}
export async function asignarCuentaPago(id, cuenta) { await q('update quote_payments set treasury_account_id = $2, updated_at = now() where id = $1', [id, cuenta || null]); return { ok: true }; }
export async function transferir({ desde, hacia, monto, fecha, nota }) {
  if (!desde || !hacia || desde === hacia) throw new Error('Elegí dos cuentas distintas.');
  if (!(num(monto) > 0)) throw new Error('El monto tiene que ser mayor que 0.');
  await q('insert into treasury_transfers (from_account_id, to_account_id, amount, transfer_date, notes) values ($1, $2, $3, $4, $5)', [desde, hacia, num(monto), fecha || hoyHn(), nota || null]);
  return { ok: true };
}

// ---------- clientes ----------
export async function clientes({ buscar = '', estado = '' } = {}) {
  const p = [], cond = [];
  if (buscar) { p.push(`%${buscar}%`); cond.push(`(c.name ilike $${p.length} or c.business_name ilike $${p.length} or c.phone ilike $${p.length} or c.sector ilike $${p.length})`); }
  // El estado guardado casi nunca se actualizó: quien compró o pagó es cliente activo, salvo que esté pausado o cerrado.
  const filas = await q(`select c.id, c.name, c.business_name, c.phone, c.email, c.sector, c.status, c.source, c.created_at, c.website_url,
      count(qq.id)::int as cotizaciones, coalesce(sum(qq.total_hnl) filter (where qq.status = 'accepted'), 0)::float as vendido,
      coalesce((select sum(p.amount) from quote_payments p where p.client_id = c.id), 0)::float as pagado, max(qq.created_at) as ultima
    from clients c left join quotes qq on qq.client_id = c.id ${cond.length ? `where ${cond.join(' and ')}` : ''}
    group by c.id order by coalesce(max(qq.created_at), c.created_at) desc limit 600`, p);
  return filas.map((c) => ({ ...c, status: ['paused', 'closed'].includes(c.status) ? c.status : c.vendido > 0 || c.pagado > 0 ? 'active' : 'lead' })).filter((c) => !estado || c.status === estado);
}
export async function cliente(id) {
  const [c] = await q('select * from clients where id = $1', [id]);
  if (!c) return null;
  c.cotizaciones = await q(`select id, quote_number, status, project_status, total, total_hnl, currency, created_at, demo_url,
    coalesce((select sum(amount) from quote_payments p where p.quote_id = quotes.id), 0)::float as pagado from quotes where client_id = $1 order by created_at desc`, [id]);
  c.tareas = await q('select id, title, status, due_date, priority from tasks where client_id = $1 order by created_at desc limit 30', [id]);
  return c;
}
const CAMPOS_CLIENTE = ['name', 'business_name', 'phone', 'email', 'sector', 'status', 'rtn', 'contact_name', 'contact_role', 'website_url', 'notes', 'source'];
export async function guardarCliente(id, datos) {
  const g = Object.fromEntries(CAMPOS_CLIENTE.filter((k) => k in datos).map((k) => [k, datos[k] === '' ? null : datos[k]]));
  if (!id && !String(g.name || '').trim()) throw new Error('Falta el nombre.');
  g.updated_at = new Date();
  const cols = Object.keys(g);
  const [fila] = id
    ? await q(`update clients set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning id`, [id, ...cols.map((k) => g[k])])
    : await q(`insert into clients (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, cols.map((k) => g[k]));
  return fila;
}

// ---------- pendientes (tareas de personas) ----------
export const tareas = ({ estado = 'pending' } = {}) => q(`select t.*, c.business_name as cliente, c.name as cliente_nombre, qq.quote_number from tasks t
  left join clients c on c.id = t.client_id left join quotes qq on qq.id = t.quote_id
  ${estado === 'all' ? '' : `where coalesce(t.status, 'pending') = '${estado === 'done' ? 'done' : 'pending'}'`}
  order by (t.due_date is null), t.due_date, case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.created_at desc limit 300`);
const CAMPOS_TAREA = ['title', 'notes', 'category', 'status', 'priority', 'due_date', 'client_id', 'quote_id'];
export async function guardarTarea(id, datos) {
  const g = Object.fromEntries(CAMPOS_TAREA.filter((k) => k in datos).map((k) => [k, datos[k] === '' ? null : datos[k]]));
  if (!id && !String(g.title || '').trim()) throw new Error('Falta el título.');
  if (g.status === 'done') g.completed_at = new Date(); else if (g.status === 'pending') g.completed_at = null;
  if (!id) { g.status ||= 'pending'; g.priority ||= 'medium'; g.source = 'oficina'; }
  g.updated_at = new Date();
  const cols = Object.keys(g);
  const [fila] = id
    ? await q(`update tasks set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1 returning id`, [id, ...cols.map((k) => g[k])])
    : await q(`insert into tasks (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, cols.map((k) => g[k]));
  return fila;
}
export async function borrarTarea(id) { await q('delete from tasks where id = $1', [id]); return { ok: true }; }

// ---------- analíticas de ventas ----------
// Cohortes por mes de la primera cotización del cliente (como cresova.com): cuántos llegaron, a cuántos se les
// mandó demo, cuántos aceptaron y se entregaron, cuánto entró y cuánto costó la publicidad de ese mes.
// Los motivos se escribieron a mano: se agrupan los que dicen lo mismo.
export function grupoMotivo(m) { const t = String(m).toLowerCase(); return /presupuesto|precio|caro|falta de dinero/.test(t) ? 'Precio o presupuesto' : /sin respuesta|sin repuesta|falta de re?s?puesta|no respond|no contest|dej[oó] de contestar/.test(t) ? 'Sin respuesta' : /no aplica|no califica/.test(t) ? 'No aplica' : /futuro|no list|par[aá]ramos|despu[eé]s/.test(t) ? 'Lo dejó para después' : String(m).charAt(0).toUpperCase() + String(m).slice(1); }

export async function analiticas({ meses = 6 } = {}) {
  const cohortes = await q(`with primera as (
      select coalesce(client_id::text, lower(coalesce(client_company, client_name))) as k, min(created_at) as t from quotes group by 1),
    base as (
      select q.*, date_trunc('month', p.t)::date as cohorte from quotes q join primera p on p.k = coalesce(q.client_id::text, lower(coalesce(q.client_company, q.client_name))))
    select to_char(m.mes, 'YYYY-MM') as mes,
      count(distinct coalesce(b.client_id::text, lower(coalesce(b.client_company, b.client_name))))::int as clientes,
      count(b.id)::int as cotizaciones,
      count(b.id) filter (where b.demo_url is not null or b.project_status not in ('pending_demo') or b.sent_at is not null)::int as demos,
      count(b.id) filter (where b.status = 'accepted')::int as aceptadas,
      count(b.id) filter (where b.project_status = 'delivered')::int as entregadas,
      coalesce(sum(coalesce(b.total_hnl, b.total)) filter (where b.status = 'accepted'), 0)::float as vendido,
      coalesce((select sum(amount_hnl) from expenses e left join expense_categories c on c.id = e.category_id where c.key = 'ads_cresova' and e.status = 'paid' and date_trunc('month', coalesce(e.paid_at, e.expense_date)) = m.mes), 0)::float as publicidad,
      coalesce((select sum(amount) from quote_payments where date_trunc('month', paid_at) = m.mes), 0)::float as cobrado
    from generate_series(date_trunc('month', current_date) - ($1::int - 1) * interval '1 month', date_trunc('month', current_date), interval '1 month') as m(mes)
    left join base b on b.cohorte = m.mes group by m.mes order by m.mes`, [Math.min(24, Math.max(1, Number(meses) || 6))]);
  const [tiempos] = await q(`select
      round(avg(extract(epoch from (sent_at - created_at)) / 86400) filter (where sent_at > created_at)::numeric, 1)::float as dias_a_demo,
      round(avg(extract(epoch from (accepted_at - coalesce(sent_at, created_at))) / 86400) filter (where accepted_at is not null)::numeric, 1)::float as dias_a_cierre,
      round(avg(extract(epoch from (delivered_at - accepted_at)) / 86400) filter (where delivered_at > accepted_at)::numeric, 1)::float as dias_a_entrega
    from quotes where created_at > now() - interval '180 days'`);
  const crudos = await q(`select coalesce(nullif(trim(motivo_no_cierre), ''), '') as motivo, count(*)::int as n from quotes where status = 'rejected' and created_at > now() - interval '180 days' group by 1`);
  // Los motivos se escribieron a mano: se agrupan los que dicen lo mismo.
  const grupo = grupoMotivo;
  const porMotivo = {};
  for (const r of crudos) if (r.motivo) porMotivo[grupo(r.motivo)] = (porMotivo[grupo(r.motivo)] || 0) + r.n;
  const motivos = Object.entries(porMotivo).map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  const sin_motivo = crudos.filter((r) => !r.motivo).reduce((s, r) => s + r.n, 0);
  const [mes] = await q(`select coalesce(sum(amount) filter (where paid_at >= date_trunc('month', current_date)), 0)::float as este,
      coalesce(sum(amount) filter (where paid_at >= date_trunc('month', current_date) - interval '1 month' and paid_at <= current_date - interval '1 month'), 0)::float as anterior
    from quote_payments where paid_at >= date_trunc('month', current_date) - interval '1 month'`);
  const { state } = await import('../state.mjs');
  const etapas = await q(`select coalesce(project_status, 'pending_demo') as etapa, count(*)::int as n from quotes where status <> 'rejected' group by 1`);
  const [cfg] = await q('select costo_por_venta_maximo, ventas_punto_equilibrio from org_settings limit 1');
  return { cohortes, tiempos, motivos, sin_motivo, cobro_mes: { ...mes, meta: state.ceo?.meta || 100000 }, etapas: ETAPAS.map((e) => ({ ...e, n: etapas.find((x) => x.etapa === e.id)?.n || 0 })), metas: cfg || {} };
}
