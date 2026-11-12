// Resumen semanal del negocio para Diego (lunes 8:00 por WhatsApp). Se arma directo de la base, sin IA:
// los números tienen que ser exactos.
import { q } from './db.mjs';

const L = (n) => `L ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
const isoHn = (t) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10);

export async function resumenSemanal(ahora = Date.now()) {
  const hoy = isoHn(ahora);
  const hace7 = isoHn(ahora - 7 * 86400e3);
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const [s] = await q(`select
      (select count(*) from quotes where created_at >= $1::date + interval '6 hours')::int as nuevas,
      (select count(*) from quotes where accepted_at >= $1::date + interval '6 hours')::int as ventas,
      (select coalesce(sum(coalesce(total_hnl, total)), 0) from quotes where accepted_at >= $1::date + interval '6 hours')::float as vendido,
      (select count(*) from quotes where project_status = 'demo_sent' and sent_at >= $1::date + interval '6 hours')::int as demos,
      (select coalesce(sum(amount), 0) from quote_payments where paid_at >= $1::date)::float as cobrado,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e left join expense_categories c on c.id = e.category_id where e.status = 'paid' and coalesce(e.paid_at, e.expense_date) >= $1::date and coalesce(c.key, '') <> 'ads_clients')::float as gastos,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e join expense_categories c on c.id = e.category_id where c.key = 'ads_cresova' and e.status = 'paid' and coalesce(e.paid_at, e.expense_date) >= $1::date)::float as publicidad,
      (select coalesce(sum(amount), 0) from quote_payments where paid_at >= $2::date)::float as cobrado_mes,
      (select coalesce(sum(e.amount_hnl), 0) from expenses e left join expense_categories c on c.id = e.category_id where e.status = 'paid' and coalesce(e.paid_at, e.expense_date) >= $2::date and coalesce(c.key, '') <> 'ads_clients')::float as gastos_mes,
      (select count(*) from quotes where status = 'sent')::int as sin_respuesta,
      (select coalesce(sum(coalesce(total_hnl, total)), 0) from quotes where status = 'sent')::float as monto_sin_respuesta,
      (select coalesce(sum(greatest(coalesce(q.total_hnl, q.total) - coalesce(p.pagado, 0), 0)), 0) from quotes q left join (select quote_id, sum(amount) as pagado from quote_payments group by quote_id) p on p.quote_id = q.id where q.status = 'accepted')::float as por_cobrar,
      (select count(*) from tasks where coalesce(status, 'pending') <> 'done' and due_date < $3::date)::int as vencidos,
      (select count(*) from expenses where category_id is null)::int as sin_categoria`, [hace7, inicioMes, hoy]);
  const cobrar = await q(`select q.quote_number, coalesce(q.client_company, q.client_name) as cliente, greatest(coalesce(q.total_hnl, q.total) - coalesce(p.pagado, 0), 0)::float as saldo
    from quotes q left join (select quote_id, sum(amount) as pagado from quote_payments group by quote_id) p on p.quote_id = q.id
    where q.status = 'accepted' and coalesce(q.total_hnl, q.total) - coalesce(p.pagado, 0) > 0 order by saldo desc limit 3`);
  const atascados = await q(`select quote_number, coalesce(client_company, client_name) as cliente, project_status, extract(day from now() - coalesce(accepted_at, updated_at))::int as dias
    from quotes where status = 'accepted' and project_status in ('approved', 'in_progress', 'awaiting_approval') and coalesce(accepted_at, updated_at) < now() - interval '14 days' order by dias desc limit 3`);
  const vencidas = await q(`select title from tasks where coalesce(status, 'pending') <> 'done' and due_date < $1::date order by due_date limit 3`, [hoy]);
  const ETAPA = { approved: 'aprobado', in_progress: 'en progreso', awaiting_approval: 'esperando aprobación' };
  const utilMes = s.cobrado_mes - s.gastos_mes;
  let renov = [];
  try { renov = await (await import('./renovaciones.mjs')).proximas(60); } catch {}
  let wa = null;
  try { const c = await import('../ventas/calidad.mjs'); const v = await import('../ventas/vendedor.mjs'); wa = { calidad: v.ventasState.calidad?.ultimo?.calidad || 'sin dato', ...c.conteo(7).total }; } catch {}
  return [
    `📊 *Resumen de Cresova* · semana del ${hace7.slice(8)}/${hace7.slice(5, 7)} al ${hoy.slice(8)}/${hoy.slice(5, 7)}`,
    '',
    '*Ventas*',
    `• ${s.nuevas} cotizaciones nuevas · ${s.demos} demos enviadas`,
    `• ${s.ventas} ${s.ventas === 1 ? 'venta' : 'ventas'} cerradas por ${L(s.vendido)}`,
    `• ${s.sin_respuesta} enviadas siguen sin respuesta (${L(s.monto_sin_respuesta)})`,
    '',
    '*Plata*',
    `• Entró ${L(s.cobrado)} · salió ${L(s.gastos)}${s.publicidad ? ` (${L(s.publicidad)} en anuncios)` : ''}`,
    `• En el mes: ${L(s.cobrado_mes)} de ingresos, ${L(s.gastos_mes)} de gastos → ${utilMes >= 0 ? 'utilidad' : 'pérdida'} de ${L(Math.abs(utilMes))}`,
    `• Por cobrar: ${L(s.por_cobrar)}${cobrar.length ? `\n${cobrar.map((c) => `   – ${c.cliente}: ${L(c.saldo)}`).join('\n')}` : ''}`,
    ...(wa ? ['', '*WhatsApp de ventas*', `• Calidad (Meta): ${wa.calidad === 'GREEN' ? 'verde' : wa.calidad}`, `• Plantillas en 7 días: ${wa.marketing} de marketing · ${wa.utility} de servicio`] : []),
    ...(renov.length ? ['', '*Renovaciones (60 días)*', ...renov.map((r) => `• ${r.cliente}: hosting y dominio vencen el ${r.vence}${r.estimado ? ' (estimado)' : ''}`)] : []),
    ...(atascados.length || s.vencidos || s.sin_categoria ? ['', '*Ojo con*'] : []),
    ...atascados.map((a) => `• ${a.cliente} lleva ${a.dias} días ${ETAPA[a.project_status] || a.project_status}`),
    ...(s.vencidos ? [`• ${s.vencidos} pendiente(s) vencido(s)${vencidas.length ? `: ${vencidas.map((v) => v.title).join('; ').slice(0, 220)}` : ''}`] : []),
    ...(s.sin_categoria ? [`• ${s.sin_categoria} gastos sin categoría en Tesorería`] : []),
  ].join('\n');
}
