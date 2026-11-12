// Cobranza automática (base propia de Cresova).
// Dos fases por cotización aceptada con saldo:
//  - ANTICIPO: pagó menos del 50 %. Recordatorios a los 2, 7 y 15 días desde que se aceptó.
//  - SALDO:    ya pagó el 50 % y el proyecto está terminado/entregado. Recordatorios a los 2, 7 y 15 días desde la
//              entrega (mientras el proyecto está en curso NO se le cobra el saldo: decisión de Diego, 6 nov).
// Después del recordatorio 3 no se insiste: queda en la lista de Diego para que decida.
// Los recordatorios salen con plantilla de WhatsApp (UTILITY) para que lleguen aunque la ventana de 24 h esté cerrada.
// Lista semanal para Diego: lunes 8:30 HN por Discord.
// Todo arranca APAGADO (C.activo=false): hasta encenderlo solo se ve la vista previa.
import { q, enUso } from './db.mjs';
import { state, log, saveNow } from '../state.mjs';

state.cobranza ||= { activo: false, enviados: {}, excluidas: {}, plantillas: { anticipo: 'cresova_pago_pendiente', saldo: 'cresova_saldo_pendiente' } };
const C = state.cobranza;
C.enviados ||= {};   // quote_id -> { fase, pasos: [{ paso, ts }] }
C.excluidas ||= {}; // quote_id -> { motivo, ts } (no se les escribe)
C.plantillas ||= { anticipo: 'cresova_pago_pendiente', saldo: 'cresova_saldo_pendiente' };
C.plantillas.saldo ||= 'cresova_saldo_pendiente';
const DIAS = [2, 7, 15];
const L = (n) => `L ${Math.round(Number(n || 0)).toLocaleString('en-US')}`;
const ult8 = (t) => String(t || '').replace(/\D/g, '').slice(-8);

export async function cartera() {
  const filas = await q(`select q.id, q.quote_number, coalesce(nullif(q.client_company, ''), q.client_name) as cliente, q.client_name, q.client_phone,
      q.project_status, q.accepted_at, q.delivered_at, q.updated_at, coalesce(nullif(q.total_hnl, 0), q.total)::float as total,
      coalesce((select sum(amount) from quote_payments p where p.quote_id = q.id), 0)::float as pagado
    from quotes q where q.status = 'accepted'`);
  const ahora = Date.now();
  return filas.map((r) => {
    const saldo = Math.max(0, r.total - r.pagado);
    const fase = r.pagado < r.total * 0.5 - 1 ? 'anticipo' : 'saldo';
    const terminado = ['finished', 'delivered'].includes(r.project_status);
    const desde = fase === 'anticipo' ? r.accepted_at : terminado ? (r.delivered_at || r.updated_at) : null;
    const dias = desde ? Math.floor((ahora - new Date(desde).getTime()) / 864e5) : null;
    const env = C.enviados[r.id]?.fase === fase ? C.enviados[r.id].pasos : [];
    const toca = desde ? DIAS.filter((d) => dias >= d).length : 0; // cuántos recordatorios le tocarían a esta altura
    return { ...r, saldo, fase, terminado, dias, enviados: env.length, toca, excluida: C.excluidas[r.id] || null, ultimoEnvio: env.at(-1)?.ts || null };
  }).filter((r) => r.saldo > 1);
}

// Quién recibe recordatorio en esta vuelta (uno por cotización y como mucho uno cada 2 días: si ya iba atrasada,
// no se le mandan los 3 de golpe).
export function pendientesDeEnvio(lista) {
  return lista.filter((r) => !r.excluida && r.client_phone && r.enviados < 3 && r.toca > r.enviados
    && (r.fase === 'anticipo' || r.terminado) && (!r.ultimoEnvio || Date.now() - r.ultimoEnvio > 2 * 864e5 - 3600e3));
}

export async function vistaPrevia() {
  const lista = await cartera();
  const envios = pendientesDeEnvio(lista).map((r) => ({ cotizacion: r.quote_number, cliente: r.cliente, fase: r.fase, recordatorio: r.enviados + 1, dias: r.dias, saldo: r.saldo, plantilla: C.plantillas[r.fase] || '(falta plantilla aprobada)' }));
  return { activo: Boolean(C.activo), plantillas: C.plantillas, porCobrar: lista.reduce((s, r) => s + r.saldo, 0), lista, envios };
}

async function enviar(r) {
  const wa = await import('../ventas/whatsapp.mjs');
  const V = (await import('../ventas/vendedor.mjs')).ventasState;
  const plantilla = C.plantillas[r.fase];
  if (!plantilla) throw new Error(`No hay plantilla aprobada para la fase ${r.fase}`);
  const conv = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && ult8(c.phone) === ult8(r.client_phone)) || await wa.convParaTelefono(r.client_phone, r.cliente);
  if (!conv) throw new Error('Pidió que no lo contactemos');
  if (conv.optOut) throw new Error('Pidió que no lo contactemos');
  if (conv.pausa?.total) throw new Error('Chat en pausa total');
  await wa.mandarPlantilla(conv.id, plantilla);
  const e = (C.enviados[r.id] = C.enviados[r.id]?.fase === r.fase ? C.enviados[r.id] : { fase: r.fase, pasos: [] });
  e.pasos.push({ paso: e.pasos.length + 1, ts: Date.now() });
  saveNow();
  log('vendedor', `Cobranza: recordatorio ${e.pasos.length} de ${r.fase} a ${r.cliente} (${r.quote_number}, saldo ${L(r.saldo)})`, 'info');
  return e.pasos.length;
}

export async function correr() {
  if (!C.activo || !enUso()) return { activo: Boolean(C.activo), enviados: [] };
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  if (h < 9 || h >= 18) return { fueraDeHorario: true, enviados: [] };
  const out = [];
  const YC = await import('../ventas/ycloud.mjs');
  await YC.plantillas().catch(() => {});
  for (const r of pendientesDeEnvio(await cartera())) {
    if (!YC.aprobada(C.plantillas[r.fase])) { out.push({ cotizacion: r.quote_number, espera: `plantilla ${C.plantillas[r.fase]} sin aprobar` }); continue; }
    try { out.push({ cotizacion: r.quote_number, paso: await enviar(r) }); }
    catch (e) { out.push({ cotizacion: r.quote_number, error: e.message }); log('vendedor', `Cobranza: no salió el recordatorio a ${r.cliente}: ${e.message}`, 'warn'); }
  }
  return { enviados: out };
}

export function configurar({ activo, excluir, incluir, motivo, plantillaSaldo } = {}) {
  if (typeof activo === 'boolean') C.activo = activo;
  for (const id of [].concat(excluir || [])) C.excluidas[id] = { motivo: String(motivo || 'Lo decide Diego').slice(0, 200), ts: Date.now() };
  for (const id of [].concat(incluir || [])) delete C.excluidas[id];
  if (plantillaSaldo !== undefined) C.plantillas.saldo = plantillaSaldo || null;
  saveNow();
  return { activo: C.activo, excluidas: C.excluidas, plantillas: C.plantillas };
}

// Lista semanal para Diego (sin IA: números exactos).
export async function listaSemanal() {
  const lista = (await cartera()).sort((a, b) => b.saldo - a.saldo);
  const total = lista.reduce((s, r) => s + r.saldo, 0);
  const linea = (r) => {
    const estado = r.excluida ? 'sin escribirle (lo decidís vos)'
      : r.fase === 'saldo' && !r.terminado ? 'proyecto en curso: se cobra al entregar'
      : r.enviados >= 3 ? `3 recordatorios sin pago: decidí si se rechaza o se llama`
      : `${r.enviados} recordatorio(s) enviado(s)`;
    return `• ${r.cliente} (${r.quote_number}): ${L(r.saldo)} de ${r.fase}${r.dias != null ? `, ${r.dias} días` : ''}. ${estado}`;
  };
  const anticipo = lista.filter((r) => r.fase === 'anticipo');
  const saldo = lista.filter((r) => r.fase === 'saldo');
  return [
    `💰 **Cobranza de la semana**: ${L(total)} por cobrar en ${lista.length} cotizaciones${C.activo ? '' : ' (los recordatorios automáticos están apagados)'}`,
    anticipo.length ? `\n**Sin anticipo (${L(anticipo.reduce((s, r) => s + r.saldo, 0))})**\n${anticipo.map(linea).join('\n')}` : '',
    saldo.length ? `\n**Saldo del 50 % (${L(saldo.reduce((s, r) => s + r.saldo, 0))})**\n${saldo.map(linea).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

// Recordatorios: cada hora entre 9:00 y 18:00 HN. La lista semanal va en la página de los lunes del CEO.
setInterval(() => { correr().catch((e) => log('vendedor', `Cobranza: ${e.message}`, 'warn')); }, 60 * 60e3);


// Cobro que manda Martín (9 nov). Las reglas están acá para que no dependan del agente. El texto lo arma el código:
// Martín elige a quién, no qué se le promete. Si la ventana está cerrada, deliver manda la plantilla de pago aprobada.
export async function cobrarAnticipo({ cotizacion, probar = false }) {
  C.cobrosMartin ||= {};
  const no = (motivo) => ({ ok: false, cotizacion, enviado: false, motivo });
  const r = (await cartera()).find((x) => x.quote_number === cotizacion);
  if (!r) return no('Esa cotización no está aceptada con saldo.');
  if (r.fase !== 'anticipo') return no('Ya pagó el anticipo. Solo se cobran anticipos: el saldo lo maneja la cobranza automática cuando el proyecto se entrega.');
  if (r.excluida) return no('Diego la excluyó de la cobranza.');
  const monto = Math.max(0, Math.round(r.total / 2) - r.pagado);
  if (!monto) return no('No hay anticipo por cobrar.');
  const { ventasState: V } = await import('../ventas/vendedor.mjs');
  const calidad = V.calidad?.ultimo?.calidad;
  if (calidad && !['GREEN', 'UNKNOWN'].includes(calidad)) return no(`El número está en ${calidad}: no se cobra hasta que vuelva a verde.`);
  const h = new Date(Date.now() - 6 * 3600e3);
  if (h.getUTCDay() === 0 || h.getUTCHours() < 9 || h.getUTCHours() >= 18) return no('Solo de lunes a sábado, de 9:00 a 18:00.');
  const conv = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && ult8(c.phone) === ult8(r.client_phone));
  if (!conv) return no('No hay conversación de WhatsApp con ese cliente.');
  if (conv.optOut) return no('Pidió que no lo contactemos.');
  if (conv.pausa?.total) return no('Diego puso ese chat en pausa total.');
  const persona = [...conv.msgs].reverse().find((m) => m.role === 'equipo' && !m.desdeOficina && !m.meta?.plantilla);
  if (persona && Date.now() - persona.ts < 24 * 3600e3) return no('Diego le escribió en las últimas 24 h: ese chat lo lleva él.');
  const ult = C.cobrosMartin[r.id] || 0;
  if (Date.now() - ult < 3 * 864e5) return no('Ya le escribiste en los últimos 3 días.');
  const recientes = Object.values(C.cobrosMartin).filter((t) => Date.now() - t < 864e5).length;
  if (recientes >= 5) return no('Ya salieron 5 cobros hoy.');
  const { ventanaAbierta } = await import('../ventas/ycloud.mjs');
  const abierta = ventanaAbierta(conv);
  const recordatorio = C.enviados[r.id]?.pasos?.at(-1)?.ts || 0;
  if (!abierta && Date.now() - recordatorio < 2 * 864e5) return no('Ya recibió el recordatorio de pago en los últimos 2 días y no ha contestado. Cuando responda, el bot le pasa la cuenta.');
  const cuenta = String(V.config?.cuentaAnticipo || '').trim();
  if (abierta && !cuenta) return no('Falta cargar la cuenta oficial en Ventas.');
  const { nombreSaludo } = await import('../ventas/plantillas.mjs');
  const nombre = nombreSaludo(conv);
  const texto = `Hola${nombre === 'qué tal' ? '' : ` ${nombre}`}, te escribo por tu página web con Cresova. Para arrancar falta el anticipo del 50 %: *${L(monto)}*.\n\nPuedes depositar o transferir a:\n${cuenta}\n\nCuando hagas el pago, mándame el comprobante por aquí y arrancamos.`;
  if (probar) return { ok: true, enviado: false, prueba: true, cliente: r.cliente, monto, ventana_abierta: abierta, sale: abierta ? texto : 'plantilla cresova_pago_pendiente' };
  const wa = await import('../ventas/whatsapp.mjs');
  const ok = await wa.enviarFijo(conv.id, texto, { anticipo: true, cotizacion });
  if (!ok) return no('WhatsApp no aceptó el mensaje.');
  C.cobrosMartin[r.id] = Date.now();
  saveNow();
  log('vendedor', `Martín cobró el anticipo a ${r.cliente} (${cotizacion}, ${L(monto)})`, 'info');
  return { ok: true, enviado: true, cliente: r.cliente, monto, por: abierta ? 'mensaje con la cuenta' : 'plantilla de pago' };
}
