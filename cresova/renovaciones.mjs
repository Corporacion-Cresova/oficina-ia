// Renovaciones de hosting y dominio. El primer año va incluido en la venta; desde el segundo año se cobra.
// - Cada proyecto entregado tiene un registro con su fecha de vencimiento (tabla `renovaciones`).
//   Si nadie la anotó, se ESTIMA: fecha de aceptación + 1 año (el dominio se compra al arrancar el proyecto).
//   Diego puede corregir la fecha real del registrador, el dominio y el precio (PUT /api/cresova/renovaciones/:id).
// - A Diego: aviso a 45 días (lista por Discord, una vez por proyecto) y lo que vence en 60 días en el resumen.
// - Al cliente: aviso a 30 días con plantilla de WhatsApp. APAGADO hasta que Diego apruebe texto y precio
//   (R.avisoCliente = false). La primera renovación vence en junio de 2027.
import { q, enUso } from './db.mjs';
import { state, log, saveNow } from '../state.mjs';

state.renovaciones ||= { avisoCliente: false, precio: null, avisadosDiego: {} };
const R = state.renovaciones;
R.avisadosDiego ||= {};
const L = (n) => `L ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Crea el registro de cada proyecto entregado que todavía no tenga uno.
export async function sincronizar() {
  const r = await q(`insert into renovaciones (quote_id, cliente, telefono, dominio, vence, estimado)
    select qq.id, coalesce(nullif(qq.client_company, ''), qq.client_name), qq.client_phone, nullif(c.website_url, ''),
      (coalesce(qq.accepted_at, qq.delivered_at, qq.created_at) + interval '1 year')::date, true
    from quotes qq left join clients c on c.id = qq.client_id
    where qq.status = 'accepted' and qq.project_status in ('finished', 'delivered')
    on conflict (quote_id) do nothing returning quote_id`);
  if (r.length) log(null, `Renovaciones: ${r.length} proyecto(s) entregado(s) agregados al registro`, 'info');
  return r.length;
}

export async function lista() {
  await sincronizar();
  const filas = await q(`select r.*, qq.quote_number, (r.vence - current_date)::int as dias from renovaciones r join quotes qq on qq.id = r.quote_id order by r.vence`);
  return filas.map((f) => ({ ...f, vence: fecha(f.vence), precio: f.precio == null ? null : Number(f.precio) }));
}

export async function actualizar(id, b = {}) {
  const set = {};
  if (b.vence) { set.vence = String(b.vence).slice(0, 10); set.estimado = false; }
  if (b.dominio !== undefined) set.dominio = String(b.dominio || '').trim() || null;
  if (b.precio !== undefined) set.precio = b.precio === null || b.precio === '' ? null : Number(b.precio);
  if (b.estado && ['pendiente', 'avisado', 'cobrado', 'no_renueva'].includes(b.estado)) set.estado = b.estado;
  if (b.notas !== undefined) set.notas = String(b.notas || '').slice(0, 500);
  const cols = Object.keys(set);
  if (!cols.length) throw new Error('Nada que cambiar.');
  await q(`update renovaciones set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where quote_id = $1`, [id, ...cols.map((k) => set[k])]);
  return (await lista()).find((f) => f.quote_id === id);
}

// Para el resumen semanal.
export async function proximas(dias = 60) {
  return (await lista()).filter((f) => f.dias <= dias && !['cobrado', 'no_renueva'].includes(f.estado));
}

async function avisarDiego() {
  const pronto = (await lista()).filter((f) => f.dias <= 45 && !['cobrado', 'no_renueva'].includes(f.estado) && !R.avisadosDiego[f.quote_id]);
  if (!pronto.length) return 0;
  const { mensajeDiscord } = await import('../voz.mjs');
  await mensajeDiscord(`🔁 **Renovaciones de hosting y dominio que vencen pronto**\n${pronto.map((f) => `• ${f.cliente} (${f.dominio || 'sin dominio anotado'}): vence ${f.vence}${f.estimado ? ' (estimado)' : ''}, en ${f.dias} días${f.precio ? `, ${L(f.precio)}` : ''}`).join('\n')}\nSi no se renueva, la página del cliente se cae.`.slice(0, 1990));
  for (const f of pronto) R.avisadosDiego[f.quote_id] = Date.now();
  saveNow();
  return pronto.length;
}

// Una vez al día (10:00 HN): agrega los entregados nuevos y avisa a Diego lo que vence en 45 días.
setInterval(async () => {
  const d = new Date(Date.now() - 6 * 3600e3);
  const hoy = d.toISOString().slice(0, 10);
  if (!enUso() || d.getUTCHours() !== 10 || R.revisado === hoy) return;
  R.revisado = hoy; saveNow();
  try { await avisarDiego(); } catch (e) { log(null, `Renovaciones: ${e.message}`, 'warn'); }
}, 10 * 60e3);
