// El CEO de la oficina: dueño de la meta de plata cobrada. Cada día mira el marcador, revisa los cambios que hizo contra lo
// que predijo, decide dentro de sus reglas y solo le pregunta a Diego lo que no le toca. Las preguntas del resto del equipo
// llegan acá (d.paraCeo) y no a la Bandeja de Diego.
// El registro guarda el antes, la predicción y una serie diaria del número que cada cambio debía mover.
import { randomUUID } from 'node:crypto';
import { state, log, saveNow, addDeliverable, listDeliverables } from '../state.mjs';
import { q, enUso } from './db.mjs';
import { ventasState as V, getPlaybook } from '../ventas/vendedor.mjs';
import { etapaDe, cuentaTs, resumenEmbudo, fuenteDe } from '../ventas/etapa.mjs';
import { aprendizajeComprobado, quitarAprendizaje, listaAprendizajes } from '../memoria.mjs';
import * as settings from '../settings.mjs';
const { updateAgent, getAgent } = settings;

state.ceo ||= { meta: 100000, dias: {}, cambios: [], diario: [], decisiones: [], pausados: {}, preguntas: {} };
const C = state.ceo;
export const REGLAS = { topeAnuncios: 8000, descuentoMax: 10, cambiosAbiertos: 3, cambiosPorDia: 1, preguntasPorDia: 3, pausaMaxDias: 14 };
const PROTEGIDOS = ['ceo', 'coordinador', 'vendedor', 'constructor', 'revisor'];
const DIA = 864e5;
const hn = (t = Date.now()) => new Date(t - 6 * 3600e3);
const fecha = (t) => hn(t).toISOString().slice(0, 10);

export const METRICAS = {
  cobrado_mes: { nombre: 'Cobrado en el mes', sube: true }, cobrado_30d: { nombre: 'Cobrado (30 días)', sube: true }, anticipos_30d: { nombre: 'Anticipos cobrados (30 días)', sube: true }, anticipos_mes: { nombre: 'Anticipos cobrados en el mes', sube: true },
  demos_7d: { nombre: 'Demos enviadas (7 días)', sube: true }, leads_7d: { nombre: 'Leads nuevos (7 días)', sube: true },
  calificados_7d: { nombre: 'Leads calificados (7 días)', sube: true }, respuestas_demo_7d: { nombre: 'Clientes que respondieron su demo (7 días)', sube: true },
  por_cobrar: { nombre: 'Por cobrar', sube: false }, saldos_por_entregar: { nombre: 'Saldos atados a proyectos sin entregar', sube: false }, proyectos_sin_entregar: { nombre: 'Proyectos con anticipo sin entregar', sube: false }, llamadas: { nombre: 'Llamadas pendientes', sube: false },
};

export async function marcador() {
  const ahora = hn();
  const inicio = `${ahora.toISOString().slice(0, 8)}01`;
  const ult = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0)).getUTCDate();
  const quedan = Math.max(1, ult - ahora.getUTCDate() + 1);
  const [p] = enUso() ? await q(`select coalesce(sum(amount), 0)::float as cobrado from quote_payments where paid_at >= $1::date`, [inicio]) : [{ cobrado: 0 }];
  const [a] = enUso() ? await q(`select count(*)::int as n from (select quote_id, min(paid_at) as f from quote_payments group by quote_id) x where f >= $1::date`, [inicio]) : [{ n: 0 }];
  const [r30] = enUso() ? await q(`select coalesce(sum(amount), 0)::float as c from quote_payments where paid_at >= current_date - 30`) : [{ c: 0 }];
  const [a30] = enUso() ? await q(`select count(*)::int as n from (select quote_id, min(paid_at) as f from quote_payments group by quote_id) x where f >= current_date - 30`) : [{ n: 0 }];
  const cob = await import('./cobranza.mjs');
  const cartera = enUso() ? await cob.cartera().catch(() => []) : [];
  const pauta = await import('../pauta/index.mjs');
  const t7 = (await pauta.tablero(7).catch(() => ({}))).totales || {};
  const conv = Object.values(V.convs || {}).filter((c) => c.kind === 'whatsapp');
  const hace7 = Date.now() - 7 * DIA;
  const primero = (c) => c.msgs.find((m) => m.role === 'cliente' && !m.previo)?.ts || 0;
  const cal = await import('../ventas/calidad.mjs');
  const ll = await (await import('../ventas/llamadas.mjs')).lista().catch(() => []);
  const cobrado = Math.round(p.cobrado), falta = Math.max(0, C.meta - cobrado);
  return {
    fecha: fecha(), meta: C.meta, cobrado_mes: cobrado, falta, dias_restantes: quedan, necesario_por_dia: Math.round(falta / quedan), anticipos_equivalentes: Math.ceil(falta / 4250),
    saldos_por_entregar: Math.round(cartera.filter((r) => r.fase === 'saldo' && !r.terminado).reduce((s, r) => s + r.saldo, 0)), proyectos_sin_entregar: cartera.filter((r) => r.fase === 'saldo' && !r.terminado).length, anticipos_mes: a.n, cobrado_30d: Math.round(r30.c), anticipos_30d: a30.n, por_cobrar: Math.round(cartera.reduce((s, r) => s + r.saldo, 0)), demos_7d: conv.filter((c) => c.estado?.demoEnviada > hace7).length,
    leads_7d: conv.filter((c) => primero(c) > hace7).length, calificados_7d: t7.calificados ?? null, respuestas_demo_7d: conv.filter((c) => (c.estado?.respuestaDemo?.ts || 0) > hace7).length,
    // Sin anuncios desde el 12 nov: Diego los lleva él mismo (departamento de Pauta apagado).
    calidad_whatsapp: V.calidad?.ultimo?.calidad || null,
    plantillas_marketing_7d: cal.conteo(7).total.marketing, llamadas: ll.length,
  };
}

// Foto del día: alimenta la historia y la serie de cada cambio abierto.
export async function foto() {
  const m = await marcador();
  C.dias[m.fecha] = m;
  C.costosDia ||= {};
  C.costosDia[m.fecha] ||= { ...state.costs };
  for (const k of Object.keys(C.costosDia).sort().slice(0, -45)) delete C.costosDia[k];
  for (const k of Object.keys(C.dias).sort().slice(0, -400)) delete C.dias[k];
  for (const c of C.cambios) if (c.estado === 'abierto') {
    c.serie ||= [];
    const v = m[c.metrica];
    const u = c.serie.at(-1);
    if (u?.fecha === m.fecha) u.valor = v; else c.serie.push({ fecha: m.fecha, valor: v });
  }
  saveNow();
  return m;
}

const hoyDe = (l) => l.filter((x) => fecha(x.ts) === fecha()).length;

export async function registrarCambio({ area, cambio, por_que, hipotesis, metrica, prediccion, revisar_en_dias, como_deshacer, encargado = '', recurso = '' }) {
  const version_antes = recurso ? leerRecurso(recurso) : undefined;
  if (!METRICAS[metrica]) throw new Error(`Métrica desconocida. Opciones: ${Object.keys(METRICAS).join(', ')}`);
  const abiertos = C.cambios.filter((c) => c.estado === 'abierto');
  if (abiertos.length >= REGLAS.cambiosAbiertos) throw new Error(`Ya hay ${abiertos.length} cambios abiertos (máximo ${REGLAS.cambiosAbiertos}): cerrá uno antes de hacer otro, para saber qué funcionó.`);
  if (hoyDe(C.cambios) >= REGLAS.cambiosPorDia) throw new Error('Ya hiciste el cambio de hoy: máximo uno por día, para poder medirlo.');
  const m = await foto();
  const c = { id: randomUUID().slice(0, 8), ts: Date.now(), estado: 'abierto', area: String(area).slice(0, 40), cambio: String(cambio).slice(0, 400), por_que: String(por_que).slice(0, 500), hipotesis: String(hipotesis).slice(0, 400), metrica, antes: m[metrica], foto_antes: m, prediccion: Number(prediccion), revisar_el: fecha(Date.now() + Number(revisar_en_dias) * DIA), como_deshacer: String(como_deshacer).slice(0, 300), encargado: String(encargado).slice(0, 40), recurso: recurso || null, version_antes, serie: [{ fecha: m.fecha, valor: m[metrica] }] };
  C.cambios.push(c);
  C.cambios = C.cambios.slice(-300);
  saveNow();
  log('ceo', `Cambio: ${c.cambio.slice(0, 120)} (${METRICAS[metrica].nombre}: ${c.antes ?? 'sin dato'} → predice ${c.prediccion}, se revisa el ${c.revisar_el})`, 'ok');
  return { id: c.id, antes: c.antes, revisar_el: c.revisar_el };
}

export async function cerrarCambio({ id, resultado, aprendizaje, para = 'todos' }) {
  const c = C.cambios.find((x) => x.id === id && x.estado === 'abierto');
  if (!c) throw new Error('No hay un cambio abierto con ese id.');
  const m = await foto();
  Object.assign(c, { estado: 'cerrado', despues: m[c.metrica], foto_despues: m, resultado, aprendizaje: String(aprendizaje).slice(0, 600), cerrado: Date.now() });
  saveNow();
  if (['funcionó', 'no funcionó'].includes(resultado) && c.antes != null && c.despues != null) aprendizajeComprobado({ area: c.area, para, que: c.cambio, resultado, evidencia: `${METRICAS[c.metrica]?.nombre || c.metrica}: ${c.antes} → ${c.despues}, predijo ${c.prediccion}`, aprendizaje, fuente: 'CEO', ref: c.id });
  log('ceo', `Cambio cerrado (${resultado}): ${c.cambio.slice(0, 100)}. ${METRICAS[c.metrica]?.nombre || c.metrica}: ${c.antes ?? '?'} → ${c.despues ?? '?'} (predijo ${c.prediccion})`, resultado === 'funcionó' ? 'ok' : 'warn');
  return { id, antes: c.antes, despues: c.despues, prediccion: c.prediccion };
}

export const cambios = ({ estado } = {}) => C.cambios.filter((c) => !estado || c.estado === estado).map(({ foto_antes, foto_despues, version_antes, ...c }) => ({ ...c, se_puede_revertir: version_antes !== undefined && !c.revertido, vence: c.estado === 'abierto' && c.revisar_el <= fecha() }));

export async function anotarDia({ texto, areas = [] }) {
  const f = fecha();
  const sis = (await revision()).areas;
  const faltan = Object.keys(AREAS).filter((a) => !areas.some((x) => x.area === a));
  if (faltan.length) throw new Error(`No podés cerrar el día: faltan estas áreas: ${faltan.map((a) => AREAS[a]).join(', ')}.`);
  for (const x of areas) {
    if (x.estado === 'rojo' && !String(x.accion || '').trim()) throw new Error(`${AREAS[x.area]} está en rojo: decí qué vas a hacer (accion).`);
    if (sis[x.area]?.semaforo === 'rojo' && x.estado === 'verde' && String(x.nota || '').length < 30) throw new Error(`El sistema marca ${AREAS[x.area]} en rojo: explicá en la nota por qué la ponés en verde.`);
  }
  C.checklist ||= {};
  C.checklist[f] = { ts: Date.now(), areas: areas.map((x) => ({ area: x.area, estado: x.estado, sistema: sis[x.area]?.semaforo || null, nota: String(x.nota || '').slice(0, 300), accion: String(x.accion || '').slice(0, 300) })) };
  for (const k of Object.keys(C.checklist).sort().slice(0, -90)) delete C.checklist[k];
  C.diario = C.diario.filter((d) => d.fecha !== f);
  C.diario.push({ fecha: f, ts: Date.now(), texto: String(texto).slice(0, 2500) });
  C.diario = C.diario.slice(-120);
  saveNow();
  return { ok: true };
}

export const preguntasEquipo = () => listDeliverables().filter((d) => d.paraCeo && d.kind === 'decision' && d.status === 'pending').map((d) => ({ id: d.id, de: getAgent(d.agentId)?.nombre || d.agentId, cuando: fecha(d.ts), titulo: d.title, pregunta: d.question || '', opciones: d.options || [], resumen: String(d.summary || '').slice(0, 500), a_cliente: Boolean(d.ventasPregunta) }));

// Contesta una pregunta del equipo pasando por el mismo camino que la respuesta de Diego.
export async function resolverPregunta({ id, respuesta, nota = '', motivo }) {
  const d = listDeliverables().find((x) => x.id === id && x.paraCeo && x.status === 'pending');
  if (!d) throw new Error('Esa pregunta ya no está pendiente.');
  if (d.options?.length && !d.options.includes(respuesta)) throw new Error(`Elegí una de estas opciones: ${d.options.join(' | ')}`);
  const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/deliverables/${d.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved', answer: d.options?.length ? respuesta : '', note: d.options?.length ? nota : `${respuesta}${nota ? ` ${nota}` : ''}`, por: 'CEO' }), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`No se pudo responder (${r.status})`);
  C.decisiones.push({ ts: Date.now(), de: d.agentId, pregunta: d.question || d.title, respuesta: String(respuesta).slice(0, 400), motivo: String(motivo).slice(0, 400) });
  C.decisiones = C.decisiones.slice(-300);
  saveNow();
  return { ok: true };
}

export function preguntarADiego({ titulo, pregunta, por_que, recomendacion, opciones = [] }) {
  const f = fecha();
  C.preguntas[f] = C.preguntas[f] || 0;
  if (C.preguntas[f] >= REGLAS.preguntasPorDia) throw new Error('Ya hiciste las 3 preguntas de hoy: esperá a mañana o decidí con tus reglas.');
  C.preguntas[f]++;
  for (const k of Object.keys(C.preguntas).sort().slice(0, -30)) delete C.preguntas[k];
  const d = addDeliverable('ceo', titulo, `${por_que}\n\n**Mi recomendación:** ${recomendacion}`, { kind: 'decision', question: pregunta, options: opciones.slice(0, 4), summary: `Recomiendo: ${String(recomendacion).slice(0, 280)}` });
  saveNow();
  return { ok: true, id: d.id, quedan_hoy: REGLAS.preguntasPorDia - C.preguntas[f] };
}

export function pausarAgente({ agente, dias, motivo }) {
  if (PROTEGIDOS.includes(agente) || !getAgent(agente)) throw new Error('Ese agente no se puede pausar.');
  const d = Math.min(REGLAS.pausaMaxDias, Math.max(1, Number(dias) || 1));
  updateAgent(agente, { enabled: false });
  C.pausados[agente] = { hasta: Date.now() + d * DIA, motivo: String(motivo).slice(0, 300), ts: Date.now() };
  saveNow();
  log('ceo', `Pausó a ${getAgent(agente).nombre} por ${d} días: ${motivo}`, 'warn');
  return { ok: true, hasta: fecha(C.pausados[agente].hasta) };
}
export function reactivarAgente({ agente }) {
  if (!C.pausados[agente]) throw new Error('Ese agente no está pausado por el CEO.');
  updateAgent(agente, { enabled: true });
  delete C.pausados[agente];
  saveNow();
  log('ceo', `Reactivó a ${getAgent(agente)?.nombre || agente}`, 'ok');
  return { ok: true };
}

export async function panel() {
  const m = await marcador();
  const dias = Object.values(C.dias).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-30);
  const rev = await revision().catch(() => null);
  const hoy = C.checklist?.[fecha()] || null;
  const ab = await resultadoAB().catch(() => null);
  const listaEntregas = await entregas().catch(() => []);
  const checklist = rev ? Object.keys(AREAS).map((a) => { const h = hoy?.areas.find((x) => x.area === a); return { area: a, nombre: AREAS[a], estado: h?.estado || rev.areas[a]?.semaforo || 'amarillo', revisada: Boolean(h), nota: h?.nota || rev.areas[a]?.nota || '', accion: h?.accion || '' }; }) : [];
  return { marcador: m, embudo: resumenEmbudo(30), equipo: await marcadorEquipo().catch(() => null), aprendizajes: listaAprendizajes().slice(-20).reverse(), grandes: await grandes().catch(() => []), entregas: listaEntregas, ab: ab?.activo === false ? null : ab, ab_historial: AB.historial.slice(-8).reverse().map((h) => ({ nombre: h.nombre, decision: h.decision, aprendizaje: h.aprendizaje, veredicto: h.resultado?.veredicto })), checklist, tema_del_dia: rev?.tema_del_dia || null, reglas: REGLAS, metricas: METRICAS, dias, diario: C.diario.slice(-14).reverse(), cambios: cambios().slice().reverse().slice(0, 40), decisiones: C.decisiones.slice(-20).reverse(), pausados: Object.entries(C.pausados).map(([id, p]) => ({ agente: getAgent(id)?.nombre || id, hasta: fecha(p.hasta), motivo: p.motivo })), preguntasEquipo: preguntasEquipo().length };
}

// Una vez: las preguntas del equipo que ya estaban esperando pasan al CEO.
if (!C.migrado) {
  for (const d of listDeliverables()) if (d.kind === 'decision' && d.status === 'pending' && d.agentId !== 'ceo' && !d.devProyecto && !d.pagoAnticipo && !(d.ventasConv && !d.ventasPregunta)) d.paraCeo = true;
  C.migrado = Date.now();
  saveNow();
}
// Foto diaria (7:00 HN, antes de la ronda) y reactivar agentes vencidos. A las 14:00 contesta lo que llegó en el día.
setInterval(async () => {
  const d = hn();
  const hoy = fecha();
  for (const [id, p] of Object.entries(C.pausados)) if (Date.now() > p.hasta) { try { reactivarAgente({ agente: id }); } catch {} }
  if (d.getUTCHours() >= 7 && C.fotoDia !== hoy) { C.fotoDia = hoy; foto().catch((e) => log('ceo', `Marcador: ${e.message}`, 'warn')); }
  if (d.getUTCHours() === 14 && C.ronda14 !== hoy && preguntasEquipo().length) {
    C.ronda14 = hoy; saveNow();
    const { runAgent, isRunning } = await import('../runner.mjs');
    if (!isRunning('ceo')) runAgent('ceo', { reason: 'preguntas del equipo', instruction: 'Ronda corta de la tarde: solo contestá las preguntas del equipo con ceo_preguntas_equipo y ceo_resolver_pregunta. No hagas cambios nuevos.' });
  }
}, 10 * 60e3);
setTimeout(() => { if (!C.dias[fecha()]) foto().catch(() => {}); }, 90e3);

// ---------- Checklist diaria: el sistema junta los datos y pone el semáforo; el CEO analiza y decide ----------
// Son 10 áreas y un tema a fondo por día. No puede cerrar el día sin marcarlas todas (anotarDia lo exige).
export const AREAS = { plata: 'Plata', entregas: 'Entregas', ventas: 'Ventas', bot: 'Bot', demos: 'Demos', llamadas: 'Llamadas', contenido: 'Contenido', prospeccion: 'Prospección', equipo: 'Equipo', sistema: 'Sistema' };
const TEMAS = {
  0: ['tus propios cambios', 'Revisá tus aciertos y errores de la semana con ceo_cambios: qué predijiste, qué pasó y qué vas a dejar de hacer.'],
  1: ['llamadas', 'Revisá la lista de Llamadas: qué llamadas siguen sin hacerse, cuáles se repiten sin resultado y qué venta destrabaría cada una.'],
  2: ['bot', 'Leé con ver_conversacion los 5 chats de "muestras" completos: dónde se enfrió cada cliente y qué regla del bot hay que corregir.'],
  3: ['demos', 'Con desarrollo_estado y proyectos_lista: qué demos están atoradas, cuáles respondieron y por qué las demás no avanzan a pago.'],
  4: ['contenido', 'Con organico_por_video y publicaciones_programadas: qué contenido trae clientes y qué se está produciendo sin retorno.'],
  5: ['prospección y proyectos grandes', 'Con negocio_prospeccion y negocio_cotizaciones: qué proyectos de más de L 15,000 siguen abiertos y qué falta para cerrarlos.'],
  6: ['equipo y costos', 'Compará lo que entregó y costó cada agente contra el número que debía mover. Decidí a quién bajarle el ritmo.'],
};
const color = (rojo, amarillo) => (rojo ? 'rojo' : amarillo ? 'amarillo' : 'verde');
const enLog = (re, horas) => state.log.filter((l) => Date.now() - l.ts < horas * 3600e3 && re.test(String(l.text)));

async function datosSistema() {
  const { saldoOpenRouter } = await import('../secrets.mjs');
  const { publicCupo, isBlocked } = await import('../cupo.mjs');
  const fs = await import('node:fs');
  const { DATA_DIR } = await import('../state.mjs');
  const saldo = await saldoOpenRouter().catch(() => null);
  const s = fs.statfsSync(DATA_DIR);
  const disco = Math.round((1 - s.bavail / s.blocks) * 100);
  const cupo = publicCupo();
  const respaldo = state.respaldoCresova || null;
  return { sin_saldo_ycloud: enLog(/YCloud 403.*balance is insufficient/i, 1).filter((l) => l.agentId === 'vendedor').length, calidad_whatsapp: V.calidad?.ultimo?.calidad || null, saldo_openrouter: saldo == null ? null : Math.round(saldo * 100) / 100, disco_usado_pct: disco, cupo_semana_pct: Math.round((cupo.windows?.seven_day?.utilization || 0) * 100), claude_bloqueado: isBlocked(), respaldo, errores_24h: state.log.filter((l) => l.kind === 'error' && Date.now() - l.ts < DIA).length };
}

async function calcular() {
  const m = await marcador();
  const ahora = hn(), dia = ahora.getUTCDate(), ult = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0)).getUTCDate();
  const wa = await import('../ventas/whatsapp.mjs');
  const convs = Object.values(V.convs || {}).filter((c) => c.kind === 'whatsapp');
  const areas = {};
  const area = async (id, fn) => { try { areas[id] = await fn(); } catch (e) { areas[id] = { semaforo: 'amarillo', datos: {}, nota: `No se pudo leer: ${e.message}` }; } };
  await area('plata', async () => {
    const esperado = Math.round((m.meta * dia) / ult);
    const cob = await import('./cobranza.mjs');
    const sinAnticipo = (await cob.cartera()).filter((r) => r.fase === 'anticipo').length;
    return { semaforo: color(m.cobrado_mes < esperado * 0.5, m.cobrado_mes < esperado * 0.9), datos: { cobrado: m.cobrado_mes, deberia_llevar: esperado, falta: m.falta, necesario_por_dia: m.necesario_por_dia, por_cobrar: m.por_cobrar, aceptadas_sin_anticipo: sinAnticipo } };
  });
  await area('entregas', async () => {
    const l = await entregas();
    const sinDueno = l.filter((e) => e.bloqueo === 'nadie').map((e) => e.cliente);
    const vencidas = l.filter((e) => e.vencida).map((e) => e.cliente);
    const viejos = l.filter((e) => e.dias_desde_aceptada > 30).map((e) => e.cliente);
    return { semaforo: color(vencidas.length > 0 || viejos.length >= 3, sinDueno.length > 0 || viejos.length > 0), datos: { saldos_atados: l.reduce((s, e) => s + e.saldo, 0), proyectos: l.length, sin_dueno: sinDueno, fecha_vencida: vencidas, mas_de_30_dias: viejos } };
  });
  await area('ventas', async () => {
    const prom = wa.promesasPendientes().filter((p) => !/te escribimos por el anticipo/i.test(p.promesa)).length;
    const colg = wa.chatsColgados().length;
    // Lo que el cliente dijo que iba a hacer y nadie le preguntó (Fase 1 de compromisos, 11 nov).
    const km = (await import('../ventas/compromisos.mjs')).resumen();
    return { semaforo: color(prom >= 8 || colg >= 5 || km.toca >= 5, prom >= 3 || colg >= 1 || km.toca >= 1), datos: { leads_7d: m.leads_7d, calificados_7d: m.calificados_7d, promesas_sin_cumplir: prom, chats_sin_responder: colg, compromisos_del_cliente_sin_preguntar: km.toca, compromisos_ya_preguntados_sin_respuesta: km.preguntado, compromisos: km.lista } };
  });
  await area('bot', () => {
    const fallos = enLog(/No salió la plantilla|Error al enviar|No se pudo/i, 24).filter((l) => l.agentId === 'vendedor').length;
    const sinRespuesta = convs.filter((c) => { if (c.pausa || c.optOut || c.busy) return false; const u = c.msgs.filter((x) => !x.previo && x.role !== 'sistema').at(-1); return u?.role === 'cliente' && !u.auto && Date.now() - u.ts > 2 * 3600e3 && Date.now() - u.ts < DIA; }).length;
    const muestras = convs.filter((c) => c.msgs.some((x) => x.role === 'bot') && !c.estado?.resultado).sort((a, b) => b.ts - a.ts).slice(0, 5).map((c) => c.title);
    return { semaforo: color(fallos >= 5 || sinRespuesta >= 5, fallos >= 1 || sinRespuesta >= 1), datos: { envios_fallidos_24h: fallos, clientes_sin_respuesta_del_bot: sinRespuesta, muestras } };
  });
  await area('demos', async () => {
    const dev = await import('../desarrollo/proyectos.mjs');
    const ps = dev.listarProyectos().filter((p) => p.origen?.conv);
    const paradas = ps.filter((p) => p.estado === 'armando' && !p.tieneBuild && !p.trabajando).map((p) => p.nombre);
    return { semaforo: color(paradas.length >= 3, paradas.length >= 1), datos: { etapas_30d: resumenEmbudo(30), en_proceso: ps.filter((p) => p.trabajando).length, paradas, programadas: ps.filter((p) => p.envioProgramado).length, enviadas_7d: m.demos_7d, respondieron_7d: m.respuestas_demo_7d, anticipos_mes: m.anticipos_mes } };
  });
  await area('llamadas', () => {
    const r = Object.values(V.llamadas?.resueltas || {}).filter((x) => Date.now() - x.ts < DIA);
    const hechas = r.filter((x) => x.resultado === 'hecha').length;
    return { semaforo: color(m.llamadas >= 15, m.llamadas >= 1 && hechas === 0), datos: { por_hacer: m.llamadas, hechas_24h: hechas, no_contestaron_24h: r.filter((x) => x.resultado === 'no_contesto').length } };
  });
  await area('contenido', () => {
    const u = state.redes?.ultimo;
    if (!u || Date.now() - u.revisado > 7 * 3600e3) return { semaforo: 'amarillo', datos: {}, nota: 'La revisión de redes no está al día.' };
    const sinPublicar = Object.entries(u.redes).filter(([, r]) => (r.horasSinPublicar ?? 999) >= 24 && !r.programadas24h).map(([k]) => k);
    const fallas = Object.entries(u.redes).filter(([, r]) => r.fallas.length).map(([k]) => k);
    return { semaforo: color(sinPublicar.length >= 2 || fallas.length >= 1, sinPublicar.length === 1), datos: { redes_sin_publicar: sinPublicar, redes_con_fallas: fallas, horas_sin_publicar: Object.fromEntries(Object.entries(u.redes).map(([k, r]) => [k, r.horasSinPublicar])) } };
  });
  await area('prospeccion', async () => {
    const pr = await import('../prospeccion/index.mjs');
    const r = await pr.resumen();
    const calificados = r.campanas.reduce((s, c) => s + (c.conteo?.calificado || 0), 0);
    const gr = await grandes();
    return { semaforo: color(gr.some((g) => g.vencida), gr.some((g) => !g.proximo_paso) || (calificados > 0 && !(r.hoy?.whatsapp || r.hoy?.correo))), datos: { proyectos_grandes_abiertos: gr.length, monto_grandes: gr.reduce((s, g) => s + g.total, 0), grandes_sin_proximo_paso: gr.filter((g) => !g.proximo_paso).map((g) => g.cliente), encendida: Boolean(r.config.activo), calificados_sin_contactar: calificados, contactados_hoy: (r.hoy?.whatsapp || 0) + (r.hoy?.correo || 0), demos: r.embudo.demo, ganados: r.embudo.ganado } };
  });
  await area('equipo', () => {
    const { getAgents } = settings;
    const hace7 = Date.now() - 7 * DIA;
    const entregas = {};
    for (const d of listDeliverables()) if (d.ts > hace7) entregas[d.agentId] = (entregas[d.agentId] || 0) + 1;
    const activos = getAgents().filter((a) => a.enabled && !a.onDemand && !a.engine);
    const conError = activos.filter((a) => state.agents[a.id]?.status === 'error').map((a) => a.nombre);
    const sinEntregar = activos.filter((a) => !entregas[a.id] && a.id !== 'ceo').map((a) => a.nombre);
    const atoradas = (state.tasks || []).filter((t) => t.status === 'en_progreso' && Date.now() - (t.updatedAt || t.createdAt || 0) > DIA).map((t) => t.title.slice(0, 70));
    return { semaforo: color(conError.length > 0, sinEntregar.length > 0 || atoradas.length > 0), datos: { entregas_7d: entregas, con_error: conError, sin_entregar_7d: sinEntregar, tareas_atoradas: atoradas, pausados_por_ti: Object.keys(C.pausados) } };
  });
  await area('sistema', async () => {
    const s = await datosSistema();
    const hoyRespaldo = !s.respaldo || Date.now() - Date.parse(`${s.respaldo}T12:00:00Z`) < 2.5 * DIA;
    const noVerde = s.calidad_whatsapp && s.calidad_whatsapp !== 'GREEN' && s.calidad_whatsapp !== 'UNKNOWN';
    return { semaforo: color(s.sin_saldo_ycloud > 0 || noVerde || s.disco_usado_pct >= 90 || (s.saldo_openrouter != null && s.saldo_openrouter < 1) || s.claude_bloqueado, (s.saldo_openrouter != null && s.saldo_openrouter < 10) || s.disco_usado_pct >= 80 || s.cupo_semana_pct >= 85 || !hoyRespaldo || s.errores_24h >= 5), datos: s };
  });
  const [tema, instruccion] = TEMAS[hn().getUTCDay()];
  const extra = {};
  if (hn().getUTCDay() === 1 && enUso()) {
    const { resumenSemanal } = await import('./resumen.mjs');
    const cob = await import('./cobranza.mjs');
    extra.para_la_pagina_del_lunes = { resumen: await resumenSemanal().catch(() => ''), cobranza: await cob.listaSemanal().catch(() => '') };
  }
  return { fecha: fecha(), areas, tema_del_dia: { tema, instruccion }, preguntas_del_equipo: preguntasEquipo().length, encargos_de_diego: C.encargos || [], ...extra };
}
let cacheRev = { ts: 0, v: null };
export async function revision({ fresca = false } = {}) {
  if (!fresca && cacheRev.v && Date.now() - cacheRev.ts < 5 * 60e3) return cacheRev.v;
  const v = await calcular();
  cacheRev = { ts: Date.now(), v };
  return v;
}

// Avisos que no esperan a la ronda del CEO: una vez por tipo y por día.
const GRAVES = [
  ['ycloud', (s) => s.sin_saldo_ycloud > 0, 'YCloud se quedó sin saldo: los mensajes de WhatsApp no están saliendo.'],
  ['openrouter', (s) => s.saldo_openrouter != null && s.saldo_openrouter < 1, 'OpenRouter casi sin saldo: es el respaldo del vendedor y el que ve los videos.'],
  ['disco', (s) => s.disco_usado_pct >= 90, 'El disco del servidor está a más de 90 %: si se llena, se cae la oficina.'],
  ['claude', (s) => s.claude_bloqueado, 'Se acabó el cupo de Claude: los agentes están detenidos.'],
];
setInterval(async () => {
  try {
    const s = await datosSistema();
    const hoy = fecha();
    C.graves ||= {};
    for (const [id, cond, texto] of GRAVES) if (cond(s) && C.graves[id] !== hoy) {
      C.graves[id] = hoy; saveNow();
      const { mensajeDiscord } = await import('../voz.mjs');
      await mensajeDiscord(`🚨 **${texto}**`).catch(() => {});
      log('ceo', `Alerta: ${texto}`, 'warn');
    }
  } catch {}
}, 30 * 60e3);

// ---------- Experimentos: versión anterior, volver atrás y grupos A/B del bot ----------
// Cada cambio puede guardar la versión exacta de lo que va a tocar (recurso). Volver atrás la restaura.
// A/B: los leads nuevos se reparten en A (bot actual) y B (bot + instrucción de la prueba) y se comparan por grupo.
export const RECURSOS = 'playbook, reglas, seguimientos, autonomia, conocimiento o prompt:<id del agente>';
function leerRecurso(r) {
  if (r === 'playbook') return getPlaybook();
  if (r === 'reglas') return JSON.parse(JSON.stringify(V.rules));
  if (r === 'seguimientos') return JSON.parse(JSON.stringify(V.seguimientos?.pasos || []));
  if (r === 'autonomia') return JSON.parse(JSON.stringify(state.autonomia || {}));
  if (r === 'conocimiento') return settings.getKnowledge();
  if (/^prompt:[\w-]+$/.test(r) && getAgent(r.slice(7))) return settings.getRolePrompt(r.slice(7));
  throw new Error(`Recurso desconocido. Opciones: ${RECURSOS}`);
}
function restaurarRecurso(r, v, motivo) {
  if (r === 'playbook') { V.playbook.push({ ts: Date.now(), by: 'ceo', resumen: `Vuelta atrás: ${motivo}`.slice(0, 300), texto: v }); if (V.playbook.length > 30) V.playbook.splice(0, V.playbook.length - 30); }
  else if (r === 'reglas') V.rules.splice(0, V.rules.length, ...JSON.parse(JSON.stringify(v)));
  else if (r === 'seguimientos') V.seguimientos.pasos = JSON.parse(JSON.stringify(v));
  else if (r === 'autonomia') Object.assign(state.autonomia, JSON.parse(JSON.stringify(v)));
  else if (r === 'conocimiento') settings.saveText('knowledge', null, v);
  else settings.saveText('prompt', r.slice(7), v);
  saveNow();
}
export function revertirCambio({ id, motivo = 'Decisión de volver atrás', por = 'CEO' }) {
  const c = C.cambios.find((x) => x.id === id);
  if (!c) throw new Error('No existe ese cambio.');
  if (!c.recurso || c.version_antes === undefined) throw new Error('Ese cambio no guardó versión: se deshace pidiéndoselo al agente.');
  if (c.revertido) throw new Error('Ese cambio ya se revirtió.');
  const posterior = C.cambios.find((x) => x.ts > c.ts && x.recurso === c.recurso && !x.revertido);
  if (posterior) throw new Error(`Hay un cambio más nuevo sobre lo mismo (${posterior.id}): revertí ese primero.`);
  restaurarRecurso(c.recurso, c.version_antes, c.cambio);
  quitarAprendizaje(c.id);
  c.revertido = { ts: Date.now(), por, motivo: String(motivo).slice(0, 300) };
  if (c.estado === 'abierto') Object.assign(c, { estado: 'cerrado', resultado: 'revertido', cerrado: Date.now(), aprendizaje: c.aprendizaje || String(motivo).slice(0, 600) });
  saveNow();
  log('ceo', `${por} volvió a la versión anterior de "${c.recurso}": ${c.cambio.slice(0, 100)}`, 'warn');
  return { ok: true, recurso: c.recurso };
}

V.ab ||= { activo: null, historial: [], turno: 0 };
const AB = V.ab;
export const METRICAS_AB = { respondieron_demo: 'Respondieron a su demo', le_gusto: 'Les gustó la demo', pidieron_cuenta: 'Recibieron la cuenta para pagar', respondieron: 'Respondieron', pidieron_demo: 'Pidieron demo', demos_enviadas: 'Recibieron demo', anticipos: 'Pagaron anticipo' };
const MINIMO_AB = 30;
export function crearAB({ nombre, hipotesis, metrica, instruccion_b, prediccion_b_pct, revisar_en_dias, puerta = 'lead' }) {
  if (AB.activo) throw new Error('Ya hay una prueba A/B corriendo: una a la vez.');
  if (!METRICAS_AB[metrica]) throw new Error(`Métrica: ${Object.keys(METRICAS_AB).join(', ')}`);
  if (C.cambios.filter((c) => c.estado === 'abierto').length >= REGLAS.cambiosAbiertos) throw new Error('Ya tenés 3 cambios abiertos: cerrá uno primero.');
  if (hoyDe(C.cambios)) throw new Error('Ya hiciste el cambio de hoy.');
  AB.activo = { id: randomUUID().slice(0, 8), ts: Date.now(), puerta: puerta === 'demo' ? 'demo' : 'lead', nombre: String(nombre).slice(0, 120), hipotesis: String(hipotesis).slice(0, 400), metrica, instruccion_b: String(instruccion_b).slice(0, 1500), prediccion_b_pct: Number(prediccion_b_pct), revisar_el: fecha(Date.now() + Number(revisar_en_dias) * DIA) };
  C.cambios.push({ id: AB.activo.id, ts: Date.now(), estado: 'abierto', area: 'Prueba A/B del bot', cambio: AB.activo.nombre, por_que: AB.activo.hipotesis, hipotesis: AB.activo.hipotesis, metrica: 'leads_7d', antes: null, prediccion: AB.activo.prediccion_b_pct, revisar_el: AB.activo.revisar_el, serie: [], ab: true });
  saveNow();
  log('ceo', `Prueba A/B del bot: ${AB.activo.nombre}`, 'ok');
  return { id: AB.activo.id, revisar_el: AB.activo.revisar_el };
}
export async function resultadoAB(exp = AB.activo) {
  if (!exp) return { activo: false };
  const convs = Object.values(V.convs).filter((c) => c.exp?.id === exp.id);
  const nums = convs.map((c) => c.estado?.cotizacion).filter(Boolean);
  const pagaron = new Set(nums.length && enUso() ? (await q('select distinct qq.quote_number from quotes qq join quote_payments p on p.quote_id = qq.id where qq.quote_number = any($1)', [nums])).map((r) => r.quote_number) : []);
  const g = (x) => {
    const l = convs.filter((c) => c.exp.grupo === x);
    const clienteTrasBot = (c) => { const i = c.msgs.findIndex((m) => m.role === 'bot'); return i >= 0 && c.msgs.slice(i + 1).some((m) => m.role === 'cliente' && !m.auto); };
    const trasDemo = (c) => c.estado?.demoEnviada && c.msgs.some((m) => m.role === 'cliente' && !m.auto && !m.previo && m.ts > c.estado.demoEnviada);
    return { leads: l.length, respondieron_demo: l.filter(trasDemo).length, le_gusto: l.filter((c) => ['gusto', 'cuenta', 'comprobante', 'pago'].includes(etapaDe(c))).length, pidieron_cuenta: l.filter((c) => cuentaTs(c)).length, respondieron: l.filter(clienteTrasBot).length, pidieron_demo: l.filter((c) => c.estado?.demo || c.estado?.pidioDemo || c.estado?.demoCreadaTs).length, demos_enviadas: l.filter((c) => c.estado?.demoEnviada).length, anticipos: l.filter((c) => pagaron.has(c.estado?.cotizacion)).length, no_contactar: l.filter((c) => c.optOut).length };
  };
  const A = g('A'), B = g('B');
  const pa = A.leads ? A[exp.metrica] / A.leads : 0, pb = B.leads ? B[exp.metrica] / B.leads : 0;
  const p = (A[exp.metrica] + B[exp.metrica]) / Math.max(1, A.leads + B.leads);
  const se = Math.sqrt(p * (1 - p) * (1 / Math.max(1, A.leads) + 1 / Math.max(1, B.leads)));
  const z = se ? (pb - pa) / se : 0;
  const suficiente = A.leads >= MINIMO_AB && B.leads >= MINIMO_AB;
  return { id: exp.id, nombre: exp.nombre, metrica: exp.metrica, metrica_nombre: METRICAS_AB[exp.metrica], revisar_el: exp.revisar_el, prediccion_b_pct: exp.prediccion_b_pct, A, B, tasa_A_pct: Math.round(pa * 1000) / 10, tasa_B_pct: Math.round(pb * 1000) / 10, minimo_por_grupo: MINIMO_AB, veredicto: !suficiente ? 'datos insuficientes' : Math.abs(z) < 1.65 ? 'sin diferencia clara' : z > 0 ? 'gana B' : 'gana A', toca_revisar: exp.revisar_el <= fecha() };
}
export async function cerrarAB({ decision, aprendizaje, por = 'CEO' }) {
  const e = AB.activo;
  if (!e) throw new Error('No hay ninguna prueba A/B corriendo.');
  const r = await resultadoAB(e);
  const c = C.cambios.find((x) => x.id === e.id);
  const adoptar = decision === 'adoptar';
  if (adoptar && r.veredicto !== 'gana B') throw new Error(`No se puede adoptar con este resultado: ${r.veredicto}.`);
  AB.historial.push({ ...e, cerrada: Date.now(), decision, aprendizaje: String(aprendizaje).slice(0, 600), resultado: r });
  AB.historial = AB.historial.slice(-40);
  AB.activo = null;
  if (c) {
    Object.assign(c, { estado: 'cerrado', resultado: adoptar ? 'funcionó' : r.veredicto === 'gana A' ? 'no funcionó' : 'no concluyente', aprendizaje: String(aprendizaje).slice(0, 600), cerrado: Date.now(), detalle_ab: r });
    if (adoptar) {
      c.recurso = 'playbook'; c.version_antes = getPlaybook();
      V.playbook.push({ ts: Date.now(), by: 'ceo', resumen: `Prueba ganada: ${e.nombre}`.slice(0, 300), texto: `${getPlaybook()}\n\n## Aprendido de una prueba: ${e.nombre}\n${e.instruccion_b}`.slice(0, 40000) });
      if (V.playbook.length > 30) V.playbook.splice(0, V.playbook.length - 30);
    }
  }
  saveNow();
  if (['gana A', 'gana B'].includes(r.veredicto)) aprendizajeComprobado({ area: 'Bot', para: 'ventas', que: e.nombre, resultado: r.veredicto === 'gana B' ? 'funcionó' : 'no funcionó', evidencia: `${r.metrica_nombre}: A ${r.tasa_A_pct} % de ${r.A.leads}, B ${r.tasa_B_pct} % de ${r.B.leads}`, aprendizaje, fuente: 'Prueba A/B', ref: e.id });
  log('ceo', `${por} cerró la prueba A/B "${e.nombre}": ${decision} (${r.veredicto})`, adoptar ? 'ok' : 'warn');
  return { decision, resultado: r };
}

// Seguridad: si el número deja de estar en verde o el grupo B pide que no lo contactemos, se frena solo.
setInterval(async () => {
  try {
    const avisos = [];
    const verde = !V.calidad?.ultimo?.calidad || ['GREEN', 'UNKNOWN'].includes(V.calidad.ultimo.calidad);
    if (AB.activo) {
      const r = await resultadoAB();
      const pB = r.B.leads ? r.B.no_contactar / r.B.leads : 0, pA = r.A.leads ? r.A.no_contactar / r.A.leads : 0;
      if (!verde || (r.B.no_contactar >= 3 && pB > pA * 2)) { const n = AB.activo.nombre; await cerrarAB({ decision: 'descartar', aprendizaje: !verde ? 'Frenada sola: el número dejó de estar en verde.' : 'Frenada sola: el grupo B pidió que no lo contactemos mucho más que el A.', por: 'La seguridad' }); avisos.push(`Prueba A/B frenada: ${n}`); }
    }
    if (!verde) for (const r of ['playbook', 'reglas', 'seguimientos']) {
      const c = C.cambios.filter((x) => x.recurso === r && x.estado === 'abierto' && !x.revertido).at(-1);
      if (c) { revertirCambio({ id: c.id, motivo: 'El número dejó de estar en verde', por: 'La seguridad' }); avisos.push(`Volví a la versión anterior: ${c.cambio.slice(0, 100)}`); }
    }
    if (avisos.length) { const { mensajeDiscord } = await import('../voz.mjs'); await mensajeDiscord(`🛑 **Se activó la seguridad de los experimentos**\n${avisos.join('\n')}`).catch(() => {}); }
  } catch (e) { log('ceo', `Seguridad de experimentos: ${e.message}`, 'warn'); }
}, 30 * 60e3);

// ---------- Entregas: el saldo se cobra al entregar, así que cada proyecto parado es plata parada ----------
const BLOQUEOS = { cliente: 'El cliente', desarrollo: 'Desarrollo', diego: 'Diego', nadie: 'Sin dueño' };
export async function entregas() {
  if (!enUso()) return [];
  const cob = await import('./cobranza.mjs');
  const dev = await import('../desarrollo/proyectos.mjs');
  const ps = dev.listarProyectos();
  C.entregas ||= {};
  return (await cob.cartera()).filter((r) => r.fase === 'saldo' && !r.terminado).map((r) => {
    const p = ps.find((x) => x.origen?.cotizacion === r.quote_number);
    const conv = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && String(c.phone || '').replace(/\D/g, '').slice(-8) === String(r.client_phone || '').replace(/\D/g, '').slice(-8));
    const reales = (conv?.msgs || []).filter((m) => !m.previo && m.role !== 'sistema');
    const ultCli = reales.filter((m) => m.role === 'cliente').at(-1);
    const auto = r.project_status === 'awaiting_approval' ? { bloqueo: 'cliente', detalle: 'Esperando que el cliente apruebe' }
      : p?.trabajando ? { bloqueo: 'desarrollo', detalle: 'Luis lo está construyendo' }
      : r.project_status === 'approved' ? { bloqueo: 'nadie', detalle: 'Aprobado, sin avance registrado' }
      : { bloqueo: 'nadie', detalle: 'En progreso, sin avance registrado' };
    const m = C.entregas[r.quote_number] || {};
    const dias = Math.floor((Date.now() - new Date(r.accepted_at).getTime()) / DIA);
    return { cotizacion: r.quote_number, cliente: r.cliente, etapa: r.project_status, saldo: r.saldo, dias_desde_aceptada: dias, bloqueo: m.bloqueo || auto.bloqueo, quien: BLOQUEOS[m.bloqueo || auto.bloqueo], detalle: m.detalle || auto.detalle, proximo_paso: m.proximo_paso || '', fecha_objetivo: m.fecha_objetivo || '', revisado: m.ts ? fecha(m.ts) : null, vencida: Boolean(m.fecha_objetivo && m.fecha_objetivo < fecha()), demo: p?.preview || null, ultimo_mensaje_cliente: ultCli ? { fecha: fecha(ultCli.ts), texto: String(ultCli.text).slice(0, 140) } : null };
  }).sort((a, b) => b.saldo - a.saldo);
}
export function actualizarEntrega({ cotizacion, bloqueo, detalle, proximo_paso, fecha_objetivo }) {
  if (!BLOQUEOS[bloqueo]) throw new Error(`bloqueo: ${Object.keys(BLOQUEOS).join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_objetivo))) throw new Error('fecha_objetivo: AAAA-MM-DD');
  C.entregas ||= {};
  C.entregas[cotizacion] = { bloqueo, detalle: String(detalle).slice(0, 300), proximo_paso: String(proximo_paso).slice(0, 300), fecha_objetivo, ts: Date.now() };
  saveNow();
  return { ok: true };
}

// ---------- Proyectos grandes: una venta de estas vale por varias webs ----------
export const UMBRAL_GRANDE = 15000;
export async function grandes() {
  if (!enUso()) return [];
  C.grandes ||= {};
  const filas = await q(`select id, quote_number, coalesce(nullif(client_company, ''), client_name) as cliente, client_phone, status, coalesce(nullif(total_hnl, 0), total)::float as total, created_at, sent_at from quotes where status in ('sent', 'draft') and coalesce(nullif(total_hnl, 0), total) >= $1 order by total desc`, [UMBRAL_GRANDE]);
  return filas.map((f) => {
    const conv = Object.values(V.convs).find((c) => c.kind === 'whatsapp' && String(c.phone || '').replace(/\D/g, '').slice(-8) === String(f.client_phone || '').replace(/\D/g, '').slice(-8));
    const reales = (conv?.msgs || []).filter((m) => !m.previo && m.role !== 'sistema');
    const ult = reales.at(-1);
    const m = C.grandes[f.quote_number] || {};
    return { cotizacion: f.quote_number, cliente: f.cliente, estado: f.status, total: f.total, dias_abierta: Math.floor((Date.now() - new Date(f.sent_at || f.created_at).getTime()) / DIA), ultimo_contacto: ult ? { fecha: fecha(ult.ts), de: ult.role === 'cliente' ? 'cliente' : 'nosotros', texto: String(ult.text).slice(0, 140) } : null, situacion: m.situacion || '', proximo_paso: m.proximo_paso || '', fecha_objetivo: m.fecha_objetivo || '', vencida: Boolean(m.fecha_objetivo && m.fecha_objetivo < fecha()) };
  });
}
export function actualizarGrande({ cotizacion, situacion, proximo_paso, fecha_objetivo }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_objetivo))) throw new Error('fecha_objetivo: AAAA-MM-DD');
  C.grandes ||= {};
  C.grandes[cotizacion] = { situacion: String(situacion).slice(0, 300), proximo_paso: String(proximo_paso).slice(0, 300), fecha_objetivo, ts: Date.now() };
  saveNow();
  return { ok: true };
}

// Encargos de Diego para la próxima ronda del CEO (no se pierden aunque hoy ya haya usado su cambio del día).
export function agregarEncargo(texto) {
  C.encargos ||= [];
  const e = { id: randomUUID().slice(0, 8), ts: Date.now(), texto: String(texto).slice(0, 2500) };
  C.encargos.push(e);
  saveNow();
  return e;
}
export function encargoHecho({ id, resultado }) {
  C.encargos ||= [];
  const e = C.encargos.find((x) => x.id === id);
  if (!e) throw new Error('No existe ese encargo.');
  C.encargos = C.encargos.filter((x) => x.id !== id);
  C.decisiones.push({ ts: Date.now(), de: 'diego', pregunta: e.texto.slice(0, 200), respuesta: String(resultado).slice(0, 400), motivo: 'Encargo de Diego' });
  saveNow();
  return { ok: true };
}

// Una vez: los informes viejos del equipo dejan de esperar a Diego.
if (!C.informesLimpios) {
  for (const d of listDeliverables()) if (d.kind === 'informe' && d.status === 'pending' && d.agentId !== 'ceo') d.status = 'read';
  C.informesLimpios = Date.now();
  saveNow();
}

// ---------- Marcador del equipo: qué cuesta cada área y qué trae ----------
const AREAS_EQUIPO = { contenido: ['estratega', 'guionista', 'viralidad', 'video', 'video2', 'video3', 'community'], ventas: ['gerente_ventas'], prospeccion: ['prospector'], direccion: ['ceo', 'coordinador'] };
export async function marcadorEquipo() {
  const hace30 = Date.now() - 30 * DIA, hace7 = Date.now() - 7 * DIA;
  const primero = (c) => c.msgs.find((m) => m.role === 'cliente' && !m.previo)?.ts || 0;
  const convs = Object.values(V.convs || {}).filter((c) => c.kind === 'whatsapp' && primero(c) > hace30);
  const nums = convs.map((c) => c.estado?.cotizacion).filter(Boolean);
  const pagaron = new Set(nums.length && enUso() ? (await q('select distinct qq.quote_number from quotes qq join quote_payments p on p.quote_id = qq.id where qq.quote_number = any($1)', [nums])).map((r) => r.quote_number) : []);
  const fuentes = {};
  for (const c of convs) { const f = (fuentes[fuenteDe(c)] ||= { leads: 0, demos: 0, le_gusto: 0, cuenta: 0, anticipos: 0 }); f.leads++; if (c.estado?.demoEnviada) f.demos++; if (['gusto', 'cuenta', 'comprobante', 'pago'].includes(etapaDe(c))) f.le_gusto++; if (cuentaTs(c)) f.cuenta++; if (pagaron.has(c.estado?.cotizacion)) f.anticipos++; }
  const fechas = Object.keys(C.costosDia || {}).filter((d) => d >= fecha(hace7)).sort();
  const base = fechas.length ? C.costosDia[fechas[0]] : null;
  const entregas7 = {};
  for (const d of listDeliverables()) if (d.ts > hace7) entregas7[d.agentId] = (entregas7[d.agentId] || 0) + 1;
  const areas = Object.entries(AREAS_EQUIPO).map(([id, agentes]) => {
    const costo = base ? agentes.reduce((s, a) => s + Math.max(0, (state.costs[a] || 0) - (base[a] || 0)), 0) : null;
    const r = fuentes[id] || { leads: 0, demos: 0, anticipos: 0 };
    return { area: id, agentes: agentes.map((a) => getAgent(a)?.nombre || a), entregas_7d: agentes.reduce((s, a) => s + (entregas7[a] || 0), 0), costo_ia_usd_estimado: costo == null ? null : Math.round(costo * 100) / 100, leads_30d: r.leads, demos_30d: r.demos, anticipos_30d: r.anticipos };
  });
  return { desde_el_dia: fechas[0] || null, nota: 'El costo de IA es el valor estimado del uso del plan, no plata que salga. Sale de medir desde el día indicado.', fuentes_30d: fuentes, areas };
}
