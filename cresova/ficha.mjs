// Ficha única: todo lo de un cliente en un solo lugar, a partir de su teléfono, su conversación o su registro.
import { q, enUso } from './db.mjs';
import { etapaNombre } from '../ventas/etapa.mjs';
import * as km from '../ventas/compromisos.mjs';

const tel8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);

export async function fichaUnica({ tel, conv: convId, cliente: clienteId }) {
  const { ventasState: V } = await import('../ventas/vendedor.mjs');
  const convs = Object.values(V.convs || {}).filter((c) => c.kind === 'whatsapp');
  let conv = convId ? convs.find((c) => c.id === convId) : null;
  let cliente = null;
  const base = enUso();
  if (clienteId && base) [cliente] = await q('select * from clients where id = $1', [clienteId]);
  let k = tel8(tel) || tel8(conv?.phone) || tel8(cliente?.phone);
  if (k.length !== 8) k = '';
  if (!conv && k) conv = convs.filter((c) => tel8(c.phone) === k).sort((a, b) => b.ts - a.ts)[0] || null;
  if (!cliente && k && base) [cliente] = await q(`select * from clients where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 8) = $1 order by created_at desc limit 1`, [k]);
  if (!conv && !cliente) return null;

  let cotizaciones = [], pendientes = [];
  if (base) {
    cotizaciones = await q(`select qq.id, qq.quote_number, qq.status, qq.project_status, coalesce(nullif(qq.total_hnl, 0), qq.total)::float as total, qq.subtotal_monthly::float as mensual, qq.created_at, qq.demo_url,
      coalesce((select sum(amount) from quote_payments p where p.quote_id = qq.id), 0)::float as pagado
      from quotes qq where ($1::uuid is not null and qq.client_id = $1::uuid) or ($2 <> '' and right(regexp_replace(coalesce(qq.client_phone, ''), '\\D', '', 'g'), 8) = $2) order by qq.created_at desc limit 12`, [cliente?.id || null, k]);
    if (cliente?.id) pendientes = await q(`select id, title, due_date, priority from tasks where client_id = $1 and status <> 'done' order by due_date nulls last limit 8`, [cliente.id]);
  }
  const numeros = new Set(cotizaciones.map((c) => c.quote_number));
  const dev = await import('../desarrollo/proyectos.mjs');
  const proyectos = dev.listarProyectos().filter((p) => (conv && p.origen?.conv === conv.id) || numeros.has(p.origen?.cotizacion) || (k && tel8(p.whatsapp) === k)).map((p) => ({ id: p.id, nombre: p.nombre, estado: p.estado, preview: p.preview, tieneBuild: p.tieneBuild, compilado: p.compilado, actualizado: p.actualizado, trabajando: p.trabajando, cotizacion: p.origen?.cotizacion || null }));
  let llamadas = [];
  try { const ll = await import('../ventas/llamadas.mjs'); llamadas = (await ll.lista()).filter((f) => (conv && f.convId === conv.id) || (k && tel8(f.telefono) === k)).map((f) => ({ motivo: f.motivo, sugerencia: f.sugerencia })); } catch {}
  const msgs = conv ? (conv.msgs || []).filter((m) => !m.previo && m.role !== 'sistema').slice(-6).map((m) => ({ de: m.role === 'cliente' ? 'Cliente' : m.role === 'bot' ? 'Vendedor' : 'Diego', texto: String(m.text).slice(0, 240), ts: m.ts })) : [];
  const total = cotizaciones.filter((c) => c.status === 'accepted').reduce((s, c) => s + c.total, 0);
  const pagado = cotizaciones.reduce((s, c) => s + c.pagado, 0);
  return {
    nombre: conv?.contacto?.empresa || cliente?.business_name || cliente?.name || conv?.contacto?.nombre || conv?.title || 'Cliente',
    contacto: conv?.contacto?.nombre || cliente?.contact_name || cliente?.name || '',
    rubro: conv?.contacto?.rubro || cliente?.sector || '',
    telefono: String(conv?.phone || cliente?.phone || '').replace(/^lid:/, ''),
    clienteId: cliente?.id || null,
    conv: conv ? { id: conv.id, etapa: etapaNombre(conv), atiende: conv.pausa ? 'Diego' : 'El vendedor (IA)', anuncio: conv.anuncio?.titulo || null, ultimos: msgs, ts: conv.ts,
      compromiso: conv.estado?.compromiso ? { ...conv.estado.compromiso, estado: km.estadoDe(conv), estadoNombre: km.NOMBRE_ESTADO[km.estadoDe(conv)] } : null } : null,
    resumen: { aceptado: total, pagado, saldo: Math.max(0, total - pagado) },
    cotizaciones, proyectos, llamadas, pendientes,
  };
}
