// Modo demo: simula un día de trabajo sin llamar a Claude ni a ninguna API.
// Sirve para ver la oficina viva mientras se conectan las credenciales.
import { AGENTS } from './agents.mjs';
import { setAgent, log, addDeliverable, requestApproval, broadcast, addChatMessage } from './state.mjs';
import { linkDeliverable } from './tareas.mjs';
import { getAgent } from './settings.mjs';

const SCRIPTS = {
  estratega: [
    ['estado', 'Revisando resultados de Meta Ads de la semana'],
    ['tool', 'metaads · ads_get_ad_entities'],
    ['tool', 'metaads · ads_insights_performance_trend'],
    ['estado', 'Cruzando cotizaciones nuevas del sistema'],
    ['tool', 'cresova · list_quotes'],
    ['tool', 'uploadpost · get_analytics'],
    ['estado', 'Escribiendo 3 hipótesis y el brief creativo'],
    ['entregar', 'Brief semanal (demo)', '## Lo que pasó\n\n| Métrica | Valor |\n|---|---|\n| Gasto | L 1,050 |\n| Conversaciones WhatsApp | 23 |\n| Costo por conversación | L 45.6 |\n\n## Hipótesis\n1. El ángulo "negocio catracho" baja el costo por conversación.\n2. Los videos de proceso traen leads más calificados.\n3. Los posts educativos de IA generan más DMs.\n\n_Datos simulados: modo demo._'],
  ],
  guionista: [
    ['estado', 'Leyendo el brief de Valeria'],
    ['estado', 'Escribiendo ganchos para 4 videos'],
    ['tool', 'cresova · check_blog_seo'],
    ['estado', 'Armando storyboards escena por escena'],
    ['aprobar', 'mcp__cresova__create_blog_post', { title: '¿Tu negocio aparece cuando te buscan en Google?', status: 'draft' }],
    ['entregar', 'Paquete de contenido (demo)', '## Video 1 — "Te buscaron y no estabas"\n\n- Gancho: *Hoy 30 personas buscaron lo que vendes*\n- CTA: Escríbenos por WhatsApp\n\n_Contenido simulado: modo demo._'],
  ],
  video: [
    ['estado', 'Revisando zona segura y ganchos'],
    ['estado', 'Diseñando receta: persiana + contador + chat'],
    ['estado', 'Eligiendo SFX y música épica'],
    ['entregar', 'Plan de producción (demo)', '| Escena | Duración | Componentes |\n|---|---|---|\n| 1 | 2.5 s | texto rise + persiana |\n| 2 | 3 s | buscador tipeando |\n\n_Plan simulado: modo demo._'],
  ],
  community: [
    ['tool', 'uploadpost · get_post_comments'],
    ['estado', 'Clasificando 12 comentarios nuevos'],
    ['aprobar', 'mcp__uploadpost__reply_to_comment', { comment: '¿Cuánto cuesta una página?', reply: '¡Hola! Te contamos todo por WhatsApp 👉 +504 0000-0000' }],
    ['tool', 'uploadpost · list_scheduled'],
    ['estado', 'Revisando huecos del calendario'],
    ['entregar', 'Reporte de comunidad (demo)', '- 12 comentarios, 3 leads con intención de compra\n- Cola cubierta hasta el 24 de noviembre\n\n_Datos simulados: modo demo._'],
  ],
  media: [
    ['tool', 'metaads · ads_get_ad_entities'],
    ['estado', 'Detectando fatiga creativa'],
    ['tool', 'metaads · ads_insights_anomaly_signal'],
    ['estado', 'R2 Aspiración gana: CPA 28 % menor'],
    ['aprobar', 'mcp__metaads__ads_update_entity', { entity: 'Ad set DEMO', daily_budget: 'L150 → L180 (+20 %)' }],
    ['entregar', 'Reporte de pauta (demo)', '| Anuncio | CPA | Veredicto |\n|---|---|---|\n| R2 Aspiración | L 32 | Escalar |\n| R5 Dudas | L 71 | Pausar |\n\n_Datos simulados: modo demo._'],
  ],
};

// Para agentes sin guion propio (coordinador, viralidad…).
const GENERIC = [
  ['estado', 'Leyendo la tarea'],
  ['estado', 'Trabajando en la tarea'],
  ['entregar', 'Entrega de prueba (demo)', 'Contenido simulado: modo demo.'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();

export const isDemoRunning = (id) => running.has(id);

export async function runDemoAgent(id, { reason = 'demo', taskId } = {}) {
  if (running.has(id)) return false;
  running.add(id);
  try {
    setAgent(id, { status: 'working', text: 'Llegando al escritorio…', lastRun: Date.now() });
    log(id, `Empieza su turno (${reason})`, 'start');
    await sleep(2500);
    for (const [kind, a, b] of SCRIPTS[id] || GENERIC) {
      if (kind === 'estado') {
        setAgent(id, { status: 'working', text: a, tool: null });
        log(id, a);
      } else if (kind === 'tool') {
        setAgent(id, { status: 'tool', text: a, tool: `mcp__${a.replace(' · ', '__')}` });
      } else if (kind === 'aprobar') {
        setAgent(id, { status: 'waiting', text: `Esperando aprobación: ${a.split('__').slice(1).join(' · ')}` });
        log(id, `Pide aprobación para ${a.split('__').slice(1).join(' · ')}`, 'approval');
        const { decision } = await requestApproval(id, a, b);
        setAgent(id, { status: 'working', text: decision === 'approved' ? 'Aprobado, ejecutando…' : 'Rechazado, sigo con lo demás' });
        log(id, `Diego ${decision === 'approved' ? 'aprobó' : 'no aprobó'} la acción (demo: no se ejecuta nada real)`, decision === 'approved' ? 'ok' : 'warn');
      } else if (kind === 'entregar') {
        const d = addDeliverable(id, a, b, taskId ? { taskId } : {});
        if (taskId) linkDeliverable(taskId, d.id);
        log(id, `Entregó: ${a}`, 'deliverable');
        for (const other of AGENTS.filter((x) => x.inputs.includes(id))) broadcast({ type: 'handoff', from: id, to: other.id, title: a });
        setAgent(id, { status: 'idle', text: `Entregó: ${a}`, tool: null });
      }
      await sleep(3500 + Math.random() * 3000);
    }
  } finally {
    running.delete(id);
  }
  return true;
}

// Un día simulado: la estratega abre, los demás se encadenan.
export async function runDemoDay() {
  runDemoAgent('media', { reason: 'demo' });
  await runDemoAgent('estratega', { reason: 'demo' });
  runDemoAgent('community', { reason: 'demo' });
  await runDemoAgent('guionista', { reason: 'demo' });
  await runDemoAgent('video', { reason: 'demo' });
}

// Chat simulado: responde algo breve para probar la pantalla.
export async function chatDemoAgent(id, text) {
  if (running.has(id)) return false;
  running.add(id);
  try {
    addChatMessage(id, 'user', text);
    setAgent(id, { status: 'working', text: 'Leyendo tu mensaje…', lastRun: Date.now() });
    await sleep(2000);
    addChatMessage(id, 'agent', `Estoy en modo demo, así que no uso Claude de verdad. Recibí: "${text.slice(0, 80)}". Cuando conectes la credencial, te respondo con datos reales.`);
    setAgent(id, { status: 'idle', text: 'Disponible', tool: null });
  } finally {
    running.delete(id);
  }
  return true;
}

// Respuesta simulada en el chat grupal.
export async function demoGroupReply(id) {
  await sleep(1500);
  const a = getAgent(id);
  return a?.coordinator
    ? 'Recibido (modo demo). En modo real reviso el tablero y, si hace falta, le paso la tarea a quien corresponda. ¿@Mateo, lo ves posible?'
    : `Soy ${a?.nombre} (modo demo). Con Claude conectado te respondo con datos reales.`;
}
