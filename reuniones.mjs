// Reuniones automáticas de la oficina (los "rituales"). Mientras dura una, los participantes caminan a la Sala de juntas.
//   Lunes 9:00  · semanal de cada departamento (Pauta, Contenido, Ventas, Prospección), una tras otra: resultados contra
//                 la meta, cierre de las pruebas de la semana (predicción vs. real) y UNA prueba nueva.
//   Lunes 10:30 · dirección: Jarvis con los líderes. Lee las semanales y sale con máximo 3 decisiones. Lo que entra en la
//                 autonomía se ejecuta; lo que no, va a Diego con su evidencia (y pasa por el abogado del diablo).
//   Día 1, 11:00 · revisión mensual con el auditor independiente (Opus): qué funcionó, qué falló, qué cambia.
// La diaria es la ronda temprana de Sofía (7:15) y Tomás (7:45); Jarvis la resume en su reporte de las 8:00.
import { state, saveNow, log, broadcast } from './state.mjs';

state.reuniones ||= { hechas: {} };
const R = state.reuniones;
export const actual = () => (R.activa && R.activa.hasta > Date.now() ? R.activa : null);
function abrir(tipo, titulo, participantes, minutos) {
  R.activa = { tipo, titulo, participantes, desde: Date.now(), hasta: Date.now() + minutos * 60e3 };
  saveNow();
  broadcast({ type: 'reunion', reunion: R.activa });
  log('coordinador', `Reunión: ${titulo} (${participantes.length} en la Sala de juntas)`, 'info');
}
// Si el agente termina rapidísimo, la reunión igual dura unos minutos en la oficina para que se vea a todos en la mesa.
const MIN_MS = 4 * 60e3;
async function cerrarLuego() { const falta = (R.activa?.desde || 0) + MIN_MS - Date.now(); if (falta > 0) await new Promise((r) => setTimeout(r, falta)); cerrar(); }
function cerrar() { R.activa = null; saveNow(); broadcast({ type: 'reunion', reunion: null }); }

const DEPTOS = [
  { id: 'pauta', lider: 'media', nombre: 'Pauta (Ads)', equipo: ['media', 'analista_pauta', 'calidad_leads'],
    turnos: [
      ['analista_pauta', 'los NÚMEROS de la semana contra la anterior (pauta_tablero 7 días y 14 días): gasto, leads, costo por lead, por lead CALIFICADO, por demo y por venta, separando la campaña principal y la de pruebas, y los 2-3 anuncios que más pesan. Máximo 8 líneas.'],
      ['calidad_leads', 'la CALIDAD de los leads de la semana: cuántos calificados / dudosos / basura, de qué anuncio vino la basura y los motivos más repetidos (leads_sin_clasificar para lo pendiente). Máximo 6 líneas.'],
      ['media', 'como LÍDER: con lo que dijeron Tomás y Sofía, qué funcionó y qué no; qué prueba de la campaña de pruebas se cierra (predicción vs. real); y la prueba NUEVA de esta semana (hipótesis, qué cambia, predicción en números, cómo y cuándo se mide). Máximo 10 líneas.'],
    ] },
  { id: 'marketing', lider: 'estratega', nombre: 'Contenido orgánico', equipo: ['estratega', 'guionista', 'viralidad', 'community'],
    turnos: [
      ['community', 'las PUBLICACIONES de la semana: cuántos videos salieron por red y cómo le fue a cada uno (vistas, retención si existe, comentarios, seguidores) con `organico_por_video` (7 días; trae cada video con retención, % completo, Para ti y no seguidores) y `get_analytics` para los totales de la cuenta. Si una métrica no está disponible, decilo. Máximo 8 líneas.'],
      ['viralidad', 'con esos números (y `organico_por_video` si necesitás más detalle): qué GANCHOS y formatos retuvieron y cuáles no, y por qué creés que pasó (con evidencia, no gusto). Máximo 6 líneas.'],
      ['estratega', 'como LÍDER: la conclusión de la semana, qué dejamos de hacer y UNA prueba nueva (gancho, formato o tema) con predicción en números y cómo se mide. Máximo 10 líneas.'],
    ] },
  { id: 'ventas', lider: 'gerente_ventas', nombre: 'Ventas', equipo: ['gerente_ventas'],
    turnos: [['gerente_ventas', 'como LÍDER: leads → precio → demo → venta de la semana contra la anterior, tiempos de respuesta, motivos de pérdida, la prueba que se cierra y UNA prueba nueva. Máximo 10 líneas.']] },
  { id: 'prospeccion', lider: 'prospector', nombre: 'Prospección', equipo: ['prospector'],
    turnos: [['prospector', 'como LÍDER: respuestas, demos y ventas por campaña, qué aprendimos y UNA prueba nueva. Máximo 10 líneas.']] },
];
const INFORME = (d, chat) => `Acabás de liderar la REUNIÓN SEMANAL de ${d.nombre}. Esto se dijo en el chat del equipo:

${chat}

Entregá el informe "Semanal ${d.nombre}" con lo que salió de la reunión (no vuelvas a investigar todo: usá lo dicho y verificá solo lo que haga falta). Lo importante arriba, como siempre: cómo vamos con el número clave, qué se cierra, la prueba nueva de la semana y qué necesitás de Diego (o "nada"). Si la prueba entra en tu autonomía, ejecutala o encargala ya; si no, que la entrega sea una decisión.`;
async function correr(id, instruction, reason) {
  const { runAgent, isRunning } = await import('./runner.mjs');
  for (let i = 0; i < 40 && isRunning(id); i++) await new Promise((r) => setTimeout(r, 60e3)); // espera a que se libere
  return runAgent(id, { reason, instruction }).catch((e) => log(id, `${reason}: ${e.message}`, 'warn'));
}

// Una semanal: pasa en el chat grupal del departamento (Diego la ve en vivo y puede meterse) y el líder cierra con el informe.
export async function semanal(id) {
  const d = DEPTOS.find((x) => x.id === id);
  if (!d) throw new Error('departamento desconocido');
  const { getAgent } = await import('./settings.mjs');
  if (!getAgent(d.lider)?.enabled) return; // departamento apagado (Pauta desde el 12 nov)
  const { groupReply, isRunning } = await import('./runner.mjs');
  const { addGroupMessage, transcript } = await import('./grupo.mjs');
  const nombre = (aid) => getAgent(aid)?.nombre || aid;
  abrir('semanal', `Semanal de ${d.nombre}`, d.equipo, 45);
  addGroupMessage(d.id, 'sistema', `📋 **Empieza la reunión semanal de ${d.nombre}.** Orden: ${d.turnos.map(([a]) => nombre(a)).join(' → ')}. Diego, podés escribir en cualquier momento: el siguiente en hablar te responde.`);
  import('./voz.mjs').then((v) => v.mensajeDiscord(`📋 Empieza la **semanal de ${d.nombre}** en el chat del equipo de la oficina. Podés entrar a ver y opinar.`)).catch(() => {});
  for (const [aid, parte] of d.turnos) {
    if (!getAgent(aid)?.enabled) continue;
    for (let i = 0; i < 20 && isRunning(aid); i++) await new Promise((r) => setTimeout(r, 30e3)); // espera a que se libere
    const txt = await groupReply(aid, d.id, { encargo: parte, maxTurns: 25 }).catch(() => null);
    addGroupMessage(d.id, txt ? aid : 'sistema', txt || `${nombre(aid)} no pudo participar esta vez.`);
  }
  await correr(d.lider, INFORME(d, transcript(d.id, 12)), `informe de la semanal de ${d.nombre}`);
  addGroupMessage(d.id, 'sistema', `✅ Terminó la semanal. ${nombre(d.lider)} dejó el informe en la Bandeja.`);
  await cerrarLuego();
}
export async function semanales() {
  for (const d of DEPTOS) await semanal(d.id).catch((e) => log(d.lider, `Semanal de ${d.nombre}: ${e.message}`, 'warn'));
}
export async function direccion() {
  abrir('direccion', 'Dirección', ['coordinador', 'media', 'gerente_ventas', 'estratega', 'prospector'], 60);
  await correr('coordinador', DIRECCION, 'reunión de dirección');
  await cerrarLuego();
}
export async function mensual() {
  abrir('mensual', 'Revisión mensual', ['auditor', 'coordinador', 'media', 'gerente_ventas', 'estratega', 'prospector', 'analista_pauta'], 90);
  await correr('auditor', MENSUAL, 'revisión mensual');
  await cerrarLuego();
}

// Reloj: revisa cada minuto qué toca (hora de Honduras). Cada reunión corre una vez por día.
const hn = () => new Date(Date.now() - 6 * 3600e3);
let corriendo = false;
setInterval(async () => {
  if (corriendo) return;
  const d = hn(), dia = d.toISOString().slice(0, 10), h = d.getUTCHours(), m = d.getUTCMinutes(), sem = d.getUTCDay();
  const toca = (k, cond) => cond && R.hechas[k] !== dia;
  let tarea = null;
  if (toca('semanal', sem === 1 && (h > 9 || (h === 9 && m >= 0)) && h < 12)) tarea = ['semanal', semanales];
  else if (toca('direccion', sem === 1 && ((h === 10 && m >= 30) || (h > 10 && h < 14)) && R.hechas.semanal === dia)) tarea = ['direccion', direccion];
  else if (toca('mensual', d.getUTCDate() === 1 && h >= 11 && h < 15)) tarea = ['mensual', mensual];
  if (!tarea) return;
  corriendo = true;
  R.hechas[tarea[0]] = dia; saveNow();
  try { await tarea[1](); } finally { corriendo = false; if (R.activa) cerrar(); }
}, 60e3);
// Si la oficina se reinició en plena reunión, no quedan personajes "pegados" en la sala.
if (R.activa) R.activa = null;
