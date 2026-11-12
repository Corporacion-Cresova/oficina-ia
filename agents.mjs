// Equipo de marketing de Cresova. Cada agente tiene un rol, un horario,
// los servidores MCP que puede usar y un escritorio en la oficina.
//
// model/effort: modelo y esfuerzo propios; AGENT_MODEL / AGENT_EFFORT solo se usan si el agente no define el suyo.
// schedule: días (0=domingo … 6=sábado) y hora local (America/Tegucigalpa).
// inputs:   agentes cuyo último entregable recibe como contexto.
// mcp:      nombres de servidores de data/mcp.json que puede usar.
// studio:   trabaja dentro del estudio de video (terminal acotada, skill motion-video-director, cola de render).
// onDemand: no corre por horario; solo cuando Diego le encarga algo.
// coordinator: puede crear tareas en el tablero y es quien responde en el chat grupal.
// readsStudio: puede leer (no escribir) el estudio: guía de estilo y guiones de los videos hechos.
// learns:   investiga con YouTube y mantiene el Manual de contenido (la memoria del equipo).
// dept:     departamento (cada uno tiene su chat grupal). La coordinadora no tiene: está en todos.
// engine:   'openrouter' = no es un agente de Claude: atiende clientes con el motor de ventas (ventas/vendedor.mjs).
// sales:    gerente de ventas: lee las conversaciones del vendedor y mantiene su playbook y reglas.

export const SERVICES = { cresova: 'Sistema Cresova', uploadpost: 'Upload-Post (redes)', metaads: 'Meta Ads' };

// Departamentos de la oficina. lead = quien responde en su chat si nadie es mencionado.
export const DEPARTMENTS = [
  { id: 'marketing', nombre: 'Contenido orgánico', color: '#e30016', lead: 'estratega' },
  { id: 'ventas', nombre: 'Ventas', color: '#25b86a', lead: 'gerente_ventas' },
  { id: 'prospeccion', nombre: 'Prospección', color: '#2f7bd9', lead: 'prospector' },
  { id: 'pauta', nombre: 'Pauta (Meta Ads)', color: '#1877f2', lead: 'media' },
];

export const TIMEZONE = process.env.OFFICE_TZ || 'America/Tegucigalpa';

export const AGENTS = [
  {
    id: 'ceo',
    ceo: true,
    auditor: true, // lee negocio y pauta; no toca Meta, ordena por medio del equipo
    model: 'claude-opus-5-5',
    effort: 'high',
    nombre: 'CEO',
    rol: 'CEO: dueño de la meta de L 100,000 al mes',
    color: '#e30016',
    pelo: '#17181c',
    desk: { x: 0, y: 0 },
    // Todos los días 8:15, después de las rondas de Sofía y Tomás.
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 15 },
    maxBudgetUsd: 6,
    inputs: [],
    mcp: [],
    metrica: 'Lempiras cobrados en el mes contra la meta de L 100,000',
  },
  {
    id: 'coordinador',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    nombre: 'Jarvis',
    rol: 'Asistente de Diego (coordinación)',
    color: '#e30016',
    pelo: '#1b1b1b',
    desk: { x: 8, y: 7 },
    schedule: { days: [1, 2, 3, 4, 5], hour: 7, minute: 0 },
    inputs: [],
    mcp: ['uploadpost'],  // uploadpost: para revisar vistas y estadísticas cuando Diego pregunta
    coordinator: true,
    onDemand: true,
    readsStudio: true,
    metrica: 'Tareas terminadas y aprobadas',
  },
  {
    id: 'estratega',
    dept: 'marketing',
    learns: true,
    model: 'claude-opus-5-5',
    effort: 'medium',
    nombre: 'Valeria',
    rol: 'Investigación y análisis',
    color: '#7c5cff',
    pelo: '#2b1d14',
    desk: { x: 3, y: 2 },
    schedule: { days: [1, 4], hour: 7, minute: 30 },
    maxBudgetUsd: 6,
    inputs: ['media'],
    mcp: ['metaads', 'uploadpost'],
    readsStudio: true,
    metrica: 'Retención al segundo 3, semana a semana',
  },
  {
    id: 'guionista',
    dept: 'marketing',
    model: 'claude-opus-5-5',
    effort: 'medium',
    nombre: 'Mateo',
    rol: 'Ideas y guiones',
    color: '#ff8a3d',
    pelo: '#111111',
    desk: { x: 8, y: 2 },
    schedule: { days: [1, 4], hour: 10, minute: 30 },
    maxBudgetUsd: 5,
    inputs: ['estratega', 'viralidad'],
    mcp: [],  // la base vieja de cresova.com se desconectó el 6 nov: datos reales con negocio_*
    readsStudio: true,
    metrica: 'Ideas que pasan el comité y Diego aprueba',
  },
  {
    id: 'video',
    dept: 'marketing',
    model: 'claude-opus-5-5',
    effort: 'high',
    nombre: 'Lucía',
    rol: 'Editora de video',
    color: '#ff4f8b',
    pelo: '#6b3a1e',
    desk: { x: 13, y: 2 },
    schedule: { days: [2, 5], hour: 9, minute: 0 },
    inputs: ['guionista', 'viralidad'],
    mcp: [],
    studio: true,
    plugins: ['motion-video-director'],
    onDemand: true,
    maxBudgetUsd: 25,
    metrica: 'Videos aprobados a la primera',
  },
  {
    id: 'community',
    dept: 'marketing',
    model: 'claude-haiku-5-5',
    effort: 'medium',
    nombre: 'Andrés',
    rol: 'Publicación',
    color: '#21c48d',
    pelo: '#3a2a1a',
    desk: { x: 5, y: 7 },
    schedule: { days: [1, 4], hour: 9, minute: 0 },
    inputs: ['video'],
    mcp: ['uploadpost'],
    metrica: 'Videos publicados a tiempo, sin huecos en el calendario',
  },
  {
    id: 'media',
    dept: 'pauta',
    pauta: true,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    nombre: 'Renata',
    rol: 'Jefa de Pauta (Meta Ads)',
    color: '#2f9bff',
    pelo: '#c9a15b',
    desk: { x: 11, y: 7 },
    schedule: { days: [1, 2, 3, 4, 5], hour: 8, minute: 0 },
    inputs: ['estratega'],
    mcp: ['metaads'],  // cotizaciones y ventas reales: herramientas negocio_* (base propia)
    requires: ['METAADS_TOKEN'],
    metrica: 'Costo por lead calificado, por demo y por venta',
  },
  {
    id: 'viralidad',
    dept: 'marketing',
    model: 'claude-opus-5-5',
    effort: 'medium',
    nombre: 'Nico',
    rol: 'Comité de viralidad',
    color: '#f5b400',
    pelo: '#4a2b16',
    desk: { x: 14, y: 7 },
    schedule: { days: [2, 4], hour: 11, minute: 0 },
    inputs: ['guionista'],
    mcp: [],
    onDemand: true,
    readsStudio: true,
    metrica: 'Retención al segundo 3 de los videos aprobados',
  },
  // Editores de apoyo: trabajan igual que Lucía, en paralelo, para que el render nunca quede parado.
  ...[['video2', 'Bruno', '#ff9f43', '#3a2418'], ['video3', 'Inés', '#a66bff', '#1b1b2a']].map(([id, nombre, color, pelo]) => ({
    id,
    dept: 'marketing',
    model: 'claude-opus-5-5',
    effort: 'high',
    nombre,
    rol: 'Editor de video (apoyo)',
    color,
    pelo,
    desk: { x: 0, y: 0 },
    schedule: { days: [], hour: 0, minute: 0 },
    inputs: [],
    mcp: [],
    studio: true,
    editor: true,
    plugins: ['motion-video-director'],
    onDemand: true,
    maxBudgetUsd: 25,
    metrica: 'Videos aprobados a la primera',
  })),
  {
    id: 'gerente_ventas',
    dept: 'ventas',
    sales: true,
    model: 'claude-opus-5-5',
    effort: 'medium',
    nombre: 'Martín',
    rol: 'Gerente de Ventas',
    color: '#25b86a',
    pelo: '#3b2a1e',
    desk: { x: 0, y: 0 },
    schedule: { days: [1, 2, 3, 4, 5, 6], hour: 8, minute: 30 },
    maxBudgetUsd: 6,
    inputs: [],
    mcp: [],  // la base vieja de cresova.com se desconectó el 6 nov: datos reales con negocio_*
    metrica: 'Prospectos que pasan a demo y demos que se cierran',
  },
  {
    id: 'auditor',
    auditor: true,
    model: 'claude-opus-5-5',
    effort: 'high',
    nombre: 'Auditor',
    rol: 'Auditoría mensual independiente',
    color: '#8d93a3',
    pelo: '#d9d9d9',
    desk: { x: 0, y: 0 },
    // No trabaja por horario: lo convoca la revisión mensual (reuniones.mjs) el día 1.
    schedule: { days: [], hour: 0, minute: 0 },
    onDemand: true,
    maxBudgetUsd: 6,
    inputs: [],
    mcp: [],
    metrica: 'Que el equipo no se mienta: evidencia, pruebas medidas y criterio calibrado',
  },
  {
    id: 'analista_pauta',
    dept: 'pauta',
    pauta: true,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    nombre: 'Tomás',
    rol: 'Analista de medición (Pauta)',
    color: '#0a66c2',
    pelo: '#2b1d16',
    desk: { x: 0, y: 0 },
    // Lunes a sábado 7:45: revisa gasto, embudo, calidad y señales a Meta antes de que arranque el día.
    schedule: { days: [1, 2, 3, 4, 5, 6], hour: 7, minute: 45 },
    maxBudgetUsd: 3,
    inputs: [],
    mcp: ['metaads'],
    requires: ['METAADS_TOKEN'],
    metrica: 'Que cada lempira de pauta esté medido hasta la venta y que nada se rompa sin que Diego lo sepa',
  },
  {
    id: 'calidad_leads',
    dept: 'pauta',
    pauta: true,
    model: 'claude-haiku-5-5',
    effort: 'low',
    nombre: 'Sofía',
    rol: 'Calidad de leads (Pauta)',
    color: '#42b72a',
    pelo: '#5a3a22',
    desk: { x: 0, y: 0 },
    // Lunes a sábado 7:15: clasifica los leads de ayer antes de que Tomás mida.
    schedule: { days: [1, 2, 3, 4, 5, 6], hour: 7, minute: 15 },
    maxBudgetUsd: 2,
    inputs: [],
    mcp: [],
    metrica: 'Cada lead de anuncio clasificado (calificado, dudoso o basura con su motivo) en menos de 24 h',
  },
  {
    id: 'prospector',
    dept: 'prospeccion',
    prospeccion: true,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    nombre: 'Brújula',
    rol: 'Estratega de Prospección',
    color: '#2f7bd9',
    pelo: '#1b2433',
    desk: { x: 0, y: 0 },
    // Lunes 8:15: resumen de la semana y, si no hay campaña en curso ni propuesta pendiente, propone las siguientes.
    // Además corre sola cuando termina una campaña (prospeccion/index.mjs).
    schedule: { days: [1], hour: 8, minute: 15 },
    maxBudgetUsd: 4,
    inputs: [],
    mcp: [],
    metrica: 'Campañas de prospección que traen respuestas, demos y ventas',
  },
  {
    id: 'vendedor',
    dept: 'ventas',
    engine: 'openrouter',
    model: 'openrouter',
    nombre: 'Diego Villalta',
    rol: 'Vendedor (WhatsApp)',
    color: '#25d366',
    pelo: '#2a1a12',
    desk: { x: 0, y: 0 },
    schedule: { days: [], hour: 0, minute: 0 },
    onDemand: true,
    inputs: [],
    mcp: [],
    metrica: 'Prospectos calificados que aceptan la demo',
  },
];

// Aprobación humana: una herramienta MCP pasa sola solo si su nombre indica
// lectura y ninguna palabra indica escritura. Todo lo demás pide permiso.
const WRITE_WORDS = new Set([
  'create', 'update', 'delete', 'activate', 'boost', 'edit', 'set', 'move', 'complete', 'assign', 'record',
  'register', 'mark', 'publish', 'unpublish', 'schedule', 'send', 'reply', 'upload', 'connect', 'disconnect',
  'retry', 'hide', 'pin', 'approve', 'ignore', 'like', 'start', 'stop', 'pause', 'resume', 'manage', 'manager',
  'remove', 'add', 'cancel', 'hold', 'generate', 'run', 'submit', 'save', 'merge', 'apply', 'toggle', 'enable',
  'disable', 'archive', 'write', 'invite', 'grant', 'revoke', 'rotate', 'reset', 'clone', 'duplicate',
]);
const READ_WORDS = new Set([
  'get', 'list', 'search', 'read', 'query', 'check', 'preview', 'validate', 'find', 'insights', 'download',
  'status', 'trending', 'history', 'summary', 'details',
]);

export function needsApproval(toolName) {
  const words = toolName.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').toLowerCase().split('_');
  if (words.some((w) => WRITE_WORDS.has(w))) return true;
  return !words.some((w) => READ_WORDS.has(w));
}

// Herramientas integradas de Claude Code que los agentes pueden usar.
export const BUILTIN_ALLOWED = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
