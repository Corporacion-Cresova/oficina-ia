// Ejecuta un agente con el Claude Agent SDK y traduce lo que hace en
// eventos de la oficina (estado, bitácora, aprobaciones, entregables, chat).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { loadMcpConfig, callMcpTool } from './connections.mjs';
import { ESTUDIO_DIR, startRender } from './estudio.mjs';
import { needsApproval, BUILTIN_ALLOWED, TIMEZONE, DEPARTMENTS } from './agents.mjs';
import { getAgent, getAgents, getKnowledge, getRolePrompt, getOfficeRules, getManual, saveText } from './settings.mjs';
import { searchShorts } from './investigacion.mjs';
import { enqueueScript, encargarReplica, guionesANico, priorizar, sonGuiones } from './linea.mjs';
import { verVideo, leerFicha, fichaSinTranscripcion, listaBiblioteca } from './videos.mjs';
import { remember, memoriaBlock, aprendizajesBlock } from './memoria.mjs';
import * as ventas from './ventas/vendedor.mjs';
import { noteUsage, noteRateLimit, noteSpend, isLimitError, onLimitHit, isBlocked, queueRetry } from './cupo.mjs';
import { createTask, listTasks, updateTask, linkDeliverable, markAwaitingVideo, getTask } from './tareas.mjs';
import { transcript } from './grupo.mjs';
import {
  DATA_DIR, setAgent, log, addCost, addDeliverable, latestDeliverable, requestApproval, broadcast,
  state, saveNow, feedbackFor, recentDecisions, chatOf, addChatMessage, setChatSession, readDeliverable, listDeliverables,
} from './state.mjs';


const running = new Map();
export const isRunning = (id) => running.has(id);

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const findTask = (id) => listTasks().find((t) => t.id === id || t.id.startsWith(String(id).trim()));
const STATUS_TASK = { pendiente: 'Pendiente', en_progreso: 'En progreso', espera: 'Espera aprobación', correcciones: 'Correcciones', hecha: 'Hecha', cancelada: 'Cancelada' };

function boardSummary() {
  const tasks = listTasks();
  const line = (t) => `- [${STATUS_TASK[t.status]}] ${t.title} · ${getAgent(t.assignee)?.nombre} · id ${t.id.slice(0, 8)} · prioridad ${t.priority}${t.deliverables.length ? ` · entregables: ${t.deliverables.map((d) => d.slice(0, 8)).join(', ')}` : ''}`;
  const open = tasks.filter((t) => !['hecha', 'cancelada'].includes(t.status));
  const done = tasks.filter((t) => t.status === 'hecha').slice(-5);
  return `Abiertas (${open.length}):\n${open.map(line).join('\n') || '- ninguna'}\n\nÚltimas terminadas:\n${done.map(line).join('\n') || '- ninguna'}`;
}

export const COORDINATOR_TOOLS = ['mcp__oficina__crear_tarea', 'mcp__oficina__ver_tablero', 'mcp__oficina__comentar_tarea', 'mcp__oficina__leer_entregable'];

// Herramientas del CEO: marcador, registro de cambios con antes y después, preguntas del equipo y pausas.
const CEO_TOOLS = ['ceo_marcador_equipo', 'ceo_grandes', 'ceo_grande_actualizar', 'ceo_encargo_hecho', 'ceo_entregas', 'ceo_entrega_actualizar', 'ceo_revertir_cambio', 'ceo_ab_crear', 'ceo_ab_resultado', 'ceo_ab_cerrar', 'ceo_revision', 'ceo_marcador', 'ceo_historia', 'ceo_cambios', 'ceo_registrar_cambio', 'ceo_cerrar_cambio', 'ceo_anotar_dia', 'ceo_preguntas_equipo', 'ceo_resolver_pregunta', 'ceo_preguntar_a_diego', 'ceo_pausar_agente', 'ceo_reactivar_agente'].map((t) => `mcp__oficina__${t}`);
function ceoTools() {
  const c = () => import('./cresova/ceo.mjs');
  const r = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
  const w = (fn) => async (a) => { try { return r(await fn(await c(), a)); } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } };
  return [
    tool('ceo_marcador_equipo', 'Qué cuesta y qué trae cada área del equipo: entregas, costo estimado, leads, demos y anticipos por fuente.', {}, w((m) => m.marcadorEquipo())),
    tool('ceo_grandes', 'Cotizaciones abiertas de L 15,000 o más: monto, días abierta, último contacto y próximo paso.', {}, w((m) => m.grandes())),
    tool('ceo_grande_actualizar', 'Anota la situación de un proyecto grande, el próximo paso y una fecha objetivo.', { cotizacion: z.string(), situacion: z.string(), proximo_paso: z.string(), fecha_objetivo: z.string().describe('AAAA-MM-DD') }, w((m, a) => m.actualizarGrande(a))),
    tool('ceo_encargo_hecho', 'Marca como hecho un encargo de Diego (encargos_de_diego en ceo_revision).', { id: z.string(), resultado: z.string() }, w((m, a) => m.encargoHecho(a))),
    tool('ceo_entregas', 'Los proyectos con anticipo sin entregar: saldo atado, qué los frena, quién debe moverlos, próximo paso y fecha.', {}, w((m) => m.entregas())),
    tool('ceo_entrega_actualizar', 'Anota qué frena la entrega de un proyecto, quién debe moverlo, el próximo paso y una fecha objetivo.', { cotizacion: z.string(), bloqueo: z.enum(['cliente', 'desarrollo', 'diego', 'nadie']), detalle: z.string(), proximo_paso: z.string(), fecha_objetivo: z.string().describe('AAAA-MM-DD') }, w((m, a) => m.actualizarEntrega(a))),
    tool('ceo_revision', 'Tu checklist del día: las 10 áreas con su semáforo y sus datos, y el tema a revisar a fondo hoy. Empezá siempre por acá.', {}, w((m) => m.revision({ fresca: true }))),
    tool('ceo_marcador', 'Cómo vamos hacia la meta: cobrado del mes, cuánto falta, ritmo necesario, demos, leads, anuncios, por cobrar y calidad de WhatsApp.', {}, w((m) => m.marcador())),
    tool('ceo_historia', 'El marcador de cada día de los últimos N días, para comparar tendencias.', { dias: z.number().int().min(1).max(90).optional() }, w(async (m, { dias = 14 }) => (await m.panel()).dias.slice(-dias))),
    tool('ceo_cambios', 'Tus cambios: antes, predicción, serie diaria del número y si ya toca revisarlos. Sin estado trae todos, para aprender de los cerrados.', { estado: z.enum(['abierto', 'cerrado']).optional() }, w((m, a) => m.cambios(a))),
    tool('ceo_registrar_cambio', 'Registra un cambio ANTES de que surta efecto: guarda solo cómo estaba el número. Máximo 3 abiertos y 1 por día.', { area: z.string(), cambio: z.string(), por_que: z.string(), hipotesis: z.string(), recurso: z.string().optional().describe('Si el cambio toca algo guardable: playbook, reglas, seguimientos, autonomia, conocimiento o prompt:<id del agente>. Se guarda la versión anterior para poder volver atrás'), metrica: z.string().describe('cobrado_30d, anticipos_30d, cobrado_mes, anticipos_mes, demos_7d, leads_7d, calificados_7d, respuestas_demo_7d, por_cobrar o llamadas'), prediccion: z.number().describe('Valor esperado de esa métrica en la fecha de revisión'), revisar_en_dias: z.number().int().min(2).max(30), como_deshacer: z.string(), encargado: z.string().optional() }, w((m, a) => m.registrarCambio(a))),
    tool('ceo_revertir_cambio', 'Vuelve a la versión guardada antes de un cambio. Usalo si salió mal.', { id: z.string(), motivo: z.string() }, w((m, a) => m.revertirCambio(a))),
    tool('ceo_ab_crear', 'Prueba del bot con dos grupos: los leads nuevos se reparten en A (bot actual) y B (con tu instrucción). Una prueba a la vez.', { nombre: z.string(), hipotesis: z.string(), metrica: z.enum(['le_gusto', 'respondieron_demo', 'pidieron_cuenta', 'respondieron', 'pidieron_demo', 'demos_enviadas', 'anticipos']), puerta: z.enum(['lead', 'demo']).optional().describe('lead: desde la primera respuesta. demo: desde que recibe la demo, para pruebas de cierre'), instruccion_b: z.string().describe('La instrucción que recibe solo el grupo B'), prediccion_b_pct: z.number().describe('Tasa esperada en B, en porcentaje'), revisar_en_dias: z.number().int().min(3).max(30) }, w((m, a) => m.crearAB(a))),
    tool('ceo_ab_resultado', 'Resultado de la prueba A/B en curso, por grupo.', {}, w((m) => m.resultadoAB())),
    tool('ceo_ab_cerrar', 'Cierra la prueba A/B. adoptar solo se puede si ganó B: su instrucción pasa a ser parte del bot para todos.', { decision: z.enum(['adoptar', 'descartar']), aprendizaje: z.string() }, w((m, a) => m.cerrarAB(a))),
    tool('ceo_cerrar_cambio', 'Cierra un cambio comparando la predicción con lo que pasó.', { id: z.string(), resultado: z.enum(['funcionó', 'no funcionó', 'no concluyente']), aprendizaje: z.string(), para: z.string().optional().describe('A quién le sirve: todos, un departamento (ventas, marketing, pauta) o el id de un agente') }, w((m, a) => m.cerrarCambio(a))),
    tool('ceo_anotar_dia', 'Cierra tu día: tu resumen (5 líneas) y las 10 áreas revisadas. No se puede cerrar sin todas; cada rojo necesita acción.', { texto: z.string(), areas: z.array(z.object({ area: z.enum(['plata', 'entregas', 'ventas', 'bot', 'demos', 'llamadas', 'contenido', 'prospeccion', 'equipo', 'sistema']), estado: z.enum(['verde', 'amarillo', 'rojo']), nota: z.string().describe('Una frase con el dato que importa'), accion: z.string().optional().describe('Qué vas a hacer. Obligatoria si está en rojo') })) }, w((m, a) => m.anotarDia(a))),
    tool('ceo_preguntas_equipo', 'Las preguntas que te hizo el equipo y siguen sin respuesta.', {}, w((m) => m.preguntasEquipo())),
    tool('ceo_resolver_pregunta', 'Contesta una pregunta del equipo. Si es para un cliente, tu respuesta le llega.', { id: z.string(), respuesta: z.string().describe('Una de las opciones de la pregunta, o el texto de la respuesta si no tiene opciones'), nota: z.string().optional(), motivo: z.string().describe('Por qué decidiste eso, según qué regla') }, w((m, a) => m.resolverPregunta(a))),
    tool('ceo_preguntar_a_diego', 'Le pregunta algo a Diego. Solo lo que tus reglas no te dejan decidir. Máximo 3 por día.', { titulo: z.string().max(120), pregunta: z.string().max(300), por_que: z.string(), recomendacion: z.string(), opciones: z.array(z.string()).max(4).optional() }, w((m, a) => m.preguntarADiego(a))),
    tool('ceo_pausar_agente', 'Pausa a un agente hasta 14 días. Vuelve solo al vencer.', { agente: z.string().describe('id del agente'), dias: z.number().int().min(1).max(14), motivo: z.string() }, w((m, a) => m.pausarAgente(a))),
    tool('ceo_reactivar_agente', 'Reactiva a un agente que pausaste.', { agente: z.string() }, w((m, a) => m.reactivarAgente(a))),
  ];
}

function coordinatorTools(agent, ctx = {}) {
  return [
    tool('crear_tarea', 'Crea una tarea en el tablero para un agente. Se ejecuta sola cuando ese agente esté libre; Diego aprueba el resultado.',
      {
        asignado: z.string().describe('Nombre o id del agente (por ejemplo "Mateo" o "guionista")'),
        titulo: z.string().describe('Título corto de la tarea'),
        descripcion: z.string().describe('Qué tiene que hacer, con todo el contexto necesario'),
        prioridad: z.enum(['alta', 'media', 'baja']).optional(),
        avisar: z.boolean().optional().describe('true si Diego pidió esto expresamente o quiere enterarse al terminar: el sistema le escribe por WhatsApp apenas el agente entregue (no depende de vos ni del tope de avisos)'),
      },
      async ({ asignado, titulo, descripcion, prioridad, avisar }) => {
        // Luis y Ashley no usan el tablero: el pedido va directo al proyecto de Desarrollo que se nombre.
        if (/p[ií]xel|lupa|constructor|revisor|desarrollo/i.test(String(asignado).normalize('NFC'))) {
          try {
            const dev = await import('./desarrollo/proyectos.mjs');
            const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
            const hay = norm(`${titulo} ${descripcion}`);
            const ps = dev.listarProyectos().filter((p) => [p.id, p.nombre, p.origen?.cotizacion].some((k) => k && norm(k).length > 3 && hay.includes(norm(k))));
            if (ps.length !== 1) return fail(`Luis trabaja por proyecto. ${ps.length ? 'Coinciden varios' : 'No encontré el proyecto en el título ni la descripción'}: usá desarrollo_pedir con uno de estos ids → ${dev.listarProyectos().slice(0, 15).map((p) => `${p.id} (${p.nombre})`).join(', ')}`);
            const p = ps[0];
            dev.pedir(p.id, `${titulo}\n\n${descripcion}`, { por: agent.nombre, revisar: true }).catch((e) => log('constructor', `Pedido de ${agent.nombre} en ${p.nombre} falló: ${e.message}`, 'warn'));
            log('constructor', `${agent.nombre} le pidió trabajo a Luis en ${p.nombre}`, 'info');
            return text(`No va al tablero: se lo pasé directo a Luis en el proyecto ${p.nombre} (${p.id}). Cuando termine, Ashley lo revisa y aparece la tarjeta en la Bandeja.`);
          } catch (e) { return fail(e.message); }
        }
        try {
          const t = createTask({ assignee: asignado, title: titulo, description: descripcion, priority: prioridad || 'media', createdBy: agent.id, avisar: Boolean(avisar), pedidoDiego: Boolean(ctx.conDiego) });
          return text(`Tarea creada (id ${t.id.slice(0, 8)}) para ${getAgent(t.assignee).nombre}.`);
        } catch (e) { return fail(e.message); }
      }),
    tool('ver_tablero', 'Muestra las tareas abiertas y las últimas terminadas del tablero.', {}, async () => text(boardSummary())),
    tool('comentar_tarea', 'Agrega una nota a una tarea del tablero (contexto o corrección).', { id: z.string(), nota: z.string() },
      async ({ id, nota }) => {
        const t = findTask(id);
        if (!t) return fail('No encontré esa tarea.');
        updateTask(t.id, { note: nota }, agent.id);
        return text('Nota agregada.');
      }),
  ];
}

// Lectura de entregables: para TODOS los agentes (antes solo el coordinador podía leer lo que entregaron otros).
function lecturaTools() {
  const fmt = (d) => `${d.id.slice(0, 8)} · ${new Date(d.ts).toLocaleDateString('es-HN', { timeZone: TIMEZONE })} · ${getAgent(d.agentId)?.nombre || d.agentId} · ${d.kind}/${d.status} · ${d.title}`;
  return [
    tool('leer_entregable', 'Lee el contenido completo de un entregable (informe, guion, decisión) de cualquier agente por su id (los 8 primeros caracteres alcanzan). Para encontrar el id usá buscar_entregables.', { id: z.string() },
      async ({ id }) => {
        const d = listDeliverables().find((x) => x.id.startsWith(String(id).trim()));
        const content = d && readDeliverable(d.id);
        return content ? text(content.slice(0, 20000)) : fail('No encontré ese entregable.');
      }),
    tool('buscar_entregables', 'Busca entregables de cualquier agente (informes, guiones, rankings, decisiones). Filtros opcionales: agente (nombre o id), texto (en título, resumen o pregunta), dias (hacia atrás, por defecto 14). Devuelve id, fecha, agente y título; después leelos con leer_entregable.',
      { agente: z.string().optional(), texto: z.string().optional(), dias: z.number().int().min(1).max(120).optional(), limite: z.number().int().min(1).max(40).optional() },
      async ({ agente, texto, dias = 14, limite = 20 }) => {
        const a = agente ? getAgent(String(agente).trim().toLowerCase()) || getAgents().find((x) => x.nombre.toLowerCase() === String(agente).trim().toLowerCase()) : null;
        const q = String(texto || '').toLowerCase();
        const list = listDeliverables().filter((d) => Date.now() - d.ts < dias * 86400e3 && (!agente || d.agentId === (a?.id || String(agente).trim().toLowerCase())) && (!q || `${d.title} ${d.summary || ''} ${d.question || ''}`.toLowerCase().includes(q)))
          .sort((x, y) => y.ts - x.ts).slice(0, limite);
        return text(list.length ? list.map(fmt).join('\n') : 'No hay entregables con ese filtro.');
      }),
  ];
}

// Resumen compacto de lo programado en redes (la herramienta original ignora el límite y devuelve cientos de miles de caracteres).
function publicacionesTools() {
  return [
    tool('publicaciones_programadas', 'Resumen compacto de lo que está programado en TikTok, YouTube, Instagram y Facebook: cuántas publicaciones hay por día y las próximas. Usala en lugar de list_scheduled, que devuelve demasiado texto.', { proximas: z.number().int().min(1).max(40).optional() },
      async ({ proximas = 12 }) => {
        let r;
        try { r = await callMcpTool('uploadpost', 'list_scheduled', {}); } catch (e) { return fail(`No pude leer lo programado: ${e.message}`); }
        const posts = (r?.result?.scheduled_posts || r?.scheduled_posts || []).map((p) => ({ t: Date.parse(`${String(p.scheduled_date).replace(/Z$/, '')}Z`) - 6 * 3600e3, plat: (p.platforms || []).join('+'), titulo: String(p.title || '').split(/\r?\n/)[0].slice(0, 70), archivo: p.source_filename || '' })).filter((p) => !Number.isNaN(p.t)).sort((a, b) => a.t - b.t);
        const dia = (t) => new Date(t).toISOString().slice(0, 10);
        const porDia = {};
        for (const p of posts) porDia[dia(p.t)] = (porDia[dia(p.t)] || 0) + 1;
        return text(`Programadas: ${posts.length}.\nPor día (hora de Honduras): ${Object.entries(porDia).map(([d, n]) => `${d}: ${n}`).join(' · ') || 'ninguna'}\nPróximas:\n${posts.slice(0, proximas).map((p) => `- ${new Date(p.t).toISOString().slice(0, 16).replace('T', ' ')} · ${p.plat} · ${p.titulo}`).join('\n')}`);
      }),
    // Métricas POR VIDEO (get_history devuelve demasiado texto para leerlo entero): una tabla compacta de lo publicado
    // en los últimos días con retención al seg. 3, % que lo termina, de dónde vinieron las vistas y si eran seguidores.
    tool('organico_por_video', 'Métricas de CADA video orgánico publicado en los últimos días (TikTok y YouTube, perfil cresova): vistas, retención al segundo 3, % que lo vio completo, tiempo promedio, likes, compartidos, guardados, seguidores ganados, % de vistas desde Para ti y % de no seguidores. Usala en la semanal y para medir pruebas: reemplaza a get_history + get_post_analytics.',
      { dias: z.number().int().min(1).max(30).optional() },
      async ({ dias = 7 }) => {
        const desde = Date.now() - dias * 86400e3;
        const posts = [];
        try {
          for (let page = 1; page <= 6; page++) {
            const r = await callMcpTool('uploadpost', 'get_history', { limit: 50, page });
            const h = r?.result?.history || r?.history || [];
            for (const x of h) if (x.profile_username === 'cresova' && x.success && Date.parse(x.upload_timestamp) >= desde) posts.push(x);
            if (!h.length || Date.parse(h[h.length - 1].upload_timestamp) < desde) break;
          }
        } catch (e) { return fail(`No pude leer el historial de Upload Post: ${e.message}`); }
        const ids = [...new Set(posts.map((p) => p.request_id))];
        const filas = [];
        for (const id of ids.slice(0, 40)) {
          let a;
          try { a = await callMcpTool('uploadpost', 'get_post_analytics', { requestId: id }); } catch { continue; }
          const pl = a?.result?.platforms || a?.platforms || {};
          const p0 = posts.find((p) => p.request_id === id);
          const titulo = String(a?.result?.post?.post_title || p0?.post_title || '').split(/\r?\n/)[0].slice(0, 70);
          for (const [red, d] of Object.entries(pl)) {
            const m = d?.post_metrics;
            if (!m) continue;
            const ret = (seg) => { const x = (m.retention || []).find((r) => String(r.second) === String(seg)); return x ? Math.round(x.percentage * 100) : null; };
            const pct = (l, k, v) => { const x = (l || []).find((r) => r[k] === v); return x ? Math.round(x.percentage * 100) : null; };
            filas.push({ fecha: String(p0?.upload_timestamp || '').slice(0, 10), red, titulo, vistas: m.views ?? 0, ret3: ret(3), completo: m.full_video_watched_rate != null ? Math.round(m.full_video_watched_rate * 1000) / 10 : null, prom: m.average_time_watched ?? m.average_view_duration_seconds ?? null, likes: m.likes ?? 0, comp: m.shares ?? 0, guard: m.favorites ?? 0, seg: m.new_followers ?? m.subscribers_gained ?? 0, paraTi: pct(m.impression_sources, 'impression_source', 'For You'), noSeg: pct(m.audience_types, 'type', 'NON_FOLLOWER_PERCENT') });
          }
        }
        if (!filas.length) return text(`No hay videos de cresova con métricas en los últimos ${dias} días.`);
        filas.sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
        const v = (x, suf = '') => (x == null ? '—' : `${x}${suf}`);
        const tk = filas.filter((f) => f.red === 'tiktok' && f.vistas >= 20);
        const med = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
        return text(`Videos de los últimos ${dias} días (${ids.length} publicaciones). Fuente: Upload Post get_post_analytics, en vivo.
Mediana TikTok (videos con 20+ vistas, n=${tk.length}): vistas ${v(med(tk.map((f) => f.vistas)))} · retención seg. 3 ${v(med(tk.filter((f) => f.ret3 != null).map((f) => f.ret3)), ' %')}.

| Fecha | Red | Video | Vistas | Ret. s3 | Completo | Prom. s | Likes | Compart. | Guard. | Seguid. | Para ti | No seguidores |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${filas.map((f) => `| ${f.fecha} | ${f.red} | ${f.titulo.replace(/\|/g, '/')} | ${f.vistas} | ${v(f.ret3, ' %')} | ${v(f.completo, ' %')} | ${v(f.prom)} | ${f.likes} | ${f.comp} | ${f.guard} | ${f.seg} | ${v(f.paraTi, ' %')} | ${v(f.noSeg, ' %')} |`).join('\n')}`);
      }),
  ];
}

// Consulta de una conversación de ventas por cliente (para Jarvis y Martín).
function conversacionTools() {
  return [
    tool('pedir_llamada', 'Pone a un cliente en la sección Llamadas de Diego, con el motivo y qué decirle. Usala siempre que haga falta que Diego llame a un cliente: no crees un pendiente ni le mandes un mensaje para eso.', { cliente: z.string().min(2).describe('Nombre, empresa o teléfono'), motivo: z.string().max(220), que_decirle: z.string().max(300) },
      async ({ cliente, motivo, que_decirle }) => {
        const nz = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const hits = Object.values(ventas.ventasState.convs).filter((c) => c.kind === 'whatsapp' && nz(`${c.title} ${c.contacto?.empresa || ''} ${c.contacto?.nombre || ''} ${c.phone}`).includes(nz(cliente)));
        if (hits.length !== 1) return { content: [{ type: 'text', text: hits.length ? `Hay ${hits.length} coincidencias; precisá cuál: ${hits.slice(0, 8).map((c) => c.title).join(' | ')}` : 'No encontré ese cliente en las conversaciones de WhatsApp.' }], isError: true };
        (await import('./ventas/llamadas.mjs')).agregarLlamada(hits[0], motivo, 'pedida', que_decirle);
        return { content: [{ type: 'text', text: `${hits[0].title} quedó en Llamadas.` }] };
      }),
    tool('ver_conversacion', 'Busca la conversación de WhatsApp de un cliente por nombre, empresa o teléfono y devuelve su estado (demo, recontacto, agenda, pausa) y los últimos mensajes. Solo lectura.', { cliente: z.string().min(2), mensajes: z.number().int().min(3).max(40).optional() },
      async ({ cliente, mensajes = 14 }) => {
        const q = String(cliente).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const nz = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const hits = Object.values(ventas.ventasState.convs).filter((c) => c.kind === 'whatsapp' && nz(`${c.title} ${c.contacto?.empresa || ''} ${c.contacto?.nombre || ''} ${c.phone}`).includes(q));
        if (!hits.length) return text('No encontré ese cliente en las conversaciones de WhatsApp.');
        if (hits.length > 1) return text(`Hay ${hits.length} coincidencias; precisá cuál:\n${hits.slice(0, 8).map((c) => `- ${c.title}`).join('\n')}`);
        const c = hits[0];
        const e = c.estado || {};
        const etapaVenta = (await import('./ventas/etapa.mjs')).etapaNombre(c);
        const cab = [`Cliente: ${c.title}`, etapaVenta && `Etapa de venta: ${etapaVenta}`, c.contacto?.rubro && `Rubro: ${c.contacto.rubro}`, e.cotizacion && `Cotización: ${e.cotizacion}`, e.demoEnviada && `Demo enviada: ${new Date(e.demoEnviada).toLocaleDateString('es-HN', { timeZone: TIMEZONE })}${e.demoUrl ? ` (${e.demoUrl})` : ''}`, e.noCalificado && `No califica: ${e.noCalificado}`, c.pausa && `Pausa: ${c.pausa.motivo}`, c.recontacto && `Recontactado (cotización ${c.recontacto.cotizacion})`, c.anuncio?.titulo && `Anuncio: ${c.anuncio.titulo}`, (c.agenda || []).filter((a) => !a.hecho).length && `Agenda: ${(c.agenda || []).filter((a) => !a.hecho).map((a) => `${new Date(a.at - 6 * 3600e3).toISOString().slice(0, 10)} (${a.motivo.slice(0, 60)})`).join('; ')}`].filter(Boolean).join('\n');
        const ENT = { pendiente: ' (una palomita: NO le llegó)', entregado: ' (le llegó)', leido: ' (lo leyó)' };
        const cots = await ventas.fichaCliente(c).catch(() => null);
        const cab2 = cots?.length ? `\n\nEn el sistema de Cresova:\n${cots.map((q) => `- ${q.numero} · L ${q.total.toLocaleString('en-US')} · ${q.estado} · etapa ${q.etapa} · pagó L ${q.pagado.toLocaleString('en-US')}${q.demo ? ` · demo ${q.demo}` : ''}`).join('\n')}${c.estado?.cierre ? `\n- Paso de cierre: ${c.estado.cierre.validado ? 'anticipo pagado' : c.estado.cierre.comprobante ? 'mandó comprobante, falta que Diego lo valide' : `cuenta enviada (anticipo L ${c.estado.cierre.monto})`}` : ''}` : '';
        const prox = (await import('./ventas/whatsapp.mjs')).proximosSeguimientos({ cliente: c.phone });
        return text(`${cab}${cab2}${prox.length ? `\n\nVa a salir solo:\n${prox.map((x) => `- ${x}`).join('\n')}` : '\n\nNo tiene seguimientos programados.'}\n\nÚltimos mensajes:\n${c.msgs.slice(-mensajes).map((m) => `[${new Date(m.ts - 6 * 3600e3).toISOString().slice(5, 16).replace('T', ' ')}] ${m.role}${ENT[m.entrega] || ''}: ${String(m.text).slice(0, 300)}`).join('\n')}`);
      }),
    tool('seguimientos_programados', 'Lista todo lo que el vendedor va a mandar solo, con fecha y hora de Honduras: seguimientos de leads, los 3 seguimientos de cada demo enviada (día 1, 3 y 7) y los mensajes que agendó. Si una persona escribe a mano, cuenta como seguimiento y la secuencia se reprograma. Opcional: filtrar por cliente. Solo lectura.', { cliente: z.string().optional() },
      async ({ cliente }) => {
        const l = (await import('./ventas/whatsapp.mjs')).proximosSeguimientos({ cliente: cliente || '' });
        return text(l.length ? l.map((x) => `- ${x}`).join('\n') : 'No hay nada programado.');
      }),
    tool('chats_colgados', 'Chats que tomó una persona donde el cliente escribió y nadie contestó en 12 h, y preguntas del vendedor a Diego sin respuesta. Las promesas sin cumplir tienen su propio aviso. Solo lectura.', {},
      async () => { const l = (await import('./ventas/whatsapp.mjs')).chatsColgados(); return text(l.length ? l.map((x) => `- ${x}`).join('\n') : 'No hay chats colgando.'); }),
  ];
}
// Qué texto inicial identifica a cada anuncio (para atribuir los leads cuando el anuncio no llega con el mensaje).
function anunciosTextoTools() {
  return [
    tool('anuncio_texto_registrar', 'Asocia el texto inicial de un anuncio ("Hola, quiero ver la demo… [código]") con su nombre, para que los leads que llegan con ese texto queden atribuidos a ese anuncio en el embudo. Cada anuncio debe tener un texto inicial distinto. Solo registrá textos que Diego ya aprobó y que ya están configurados en el anuncio.', { texto: z.string().min(6).max(200), anuncio: z.string().min(2).max(120), id_anuncio: z.string().optional() },
      async ({ texto, anuncio, id_anuncio }) => { try { return text(`Registrado (${ventas.registrarAnuncioTexto({ texto, anuncio, id: id_anuncio || null })} textos en total).`); } catch (e) { return fail(e.message); } }),
    tool('anuncio_texto_lista', 'Lista los textos iniciales registrados y a qué anuncio corresponde cada uno.', {}, async () => text(JSON.stringify(ventas.listaAnunciosTexto(), null, 1))),
    // Videos para pauta: Meta pide una URL pública; los videos de la oficina están detrás de la contraseña.
    tool('anuncios_por_aprobar', 'Videos de ANUNCIO que esperan aprobación en el Estudio, con formato (9:16, 4:5, 16:9), duración y si son aptos para Meta (vertical o cuadrado y 60 s o menos).', {},
      async () => text(JSON.stringify(await (await import('./autonomia.mjs')).anunciosPorAprobar(), null, 1))),
    tool('anuncio_aprobar', 'Aprobás VOS un video de anuncio para usarlo en la campaña de pruebas (Diego te dio esa autonomía el 6 nov). El revisor automático (Gemini) lo mira antes: si saca 7+ queda aprobado y Diego recibe un aviso; si no, te devuelve los problemas. Aprobá solo los que vas a usar, con el motivo (qué hipótesis prueban).',
      { entregable: z.string().describe('id del video (8 caracteres) de anuncios_por_aprobar'), motivo: z.string().max(300) },
      async ({ entregable, motivo }) => { try { return text(JSON.stringify(await (await import('./autonomia.mjs')).aprobarAnuncio(entregable, motivo))); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } }),
    tool('anuncio_videos', 'Lista los videos de anuncio ya aprobados en el Estudio (por Diego o por vos), primero los marcados como anuncio: id, título, tipo y si ya se subieron a Meta.', {},
      async () => text(JSON.stringify((await import('./enlaces.mjs')).videosParaPauta(), null, 1))),
    tool('anuncio_video_enlace', 'Crea un enlace público TEMPORAL (vence en pocas horas) a un video aprobado, para pasarlo como media_url a la herramienta de Meta que sube videos (upload_source "URL", media_type "VIDEO"). Solo videos que Diego aprobó en el Estudio.', {
      entregable: z.string().describe('id del video (los 8 primeros caracteres sirven), de anuncio_videos'),
      horas: z.number().min(1).max(24).optional().describe('Cuánto dura el enlace (por defecto 6 h)'),
    }, async ({ entregable, horas }) => { try { return text(JSON.stringify((await import('./enlaces.mjs')).crearEnlace(entregable, { horas, por: 'media' }))); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } }),
    tool('anuncio_video_registrar', 'Después de subir un video a Meta: guarda el id del video en Meta (y el del anuncio cuando exista) en ese video, para medir costo por lead y por demo de cada video.', {
      entregable: z.string(), video_id: z.string().optional(), anuncio_id: z.string().optional(),
    }, async ({ entregable, video_id, anuncio_id }) => { try { return text(`Guardado: ${JSON.stringify((await import('./enlaces.mjs')).registrarEnMeta(entregable, { video_id, anuncio_id }))}`); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } }),
  ];
}

// Herramientas de investigación y aprendizaje (Valeria).
const LEARNING_TOOLS = ['mcp__oficina__investigar_youtube', 'mcp__oficina__actualizar_manual'];
const SALES_TOOLS = ['cobrar_anticipo', 'proyectos_lista', 'proyecto_mover', 'desarrollo_estado', 'desarrollo_pedir', 'recontacto_pausar', 'recontacto_reanudar', 'recontacto_estado', 'recontacto_cargar', 'recontacto_lista', 'recontacto_proponer', 'recontacto_pedir_aprobacion', 'leer_casos_velforce', 'leer_aprendizajes_velforce', 'ventas_resumen', 'leer_conversaciones', 'leer_correcciones', 'leer_playbook', 'actualizar_playbook', 'crear_regla', 'desactivar_regla', 'probar_vendedor'].map((t) => `mcp__oficina__${t}`);
// Biblioteca de videos: ver (Gemini, sin gastar cupo de Claude), releer y replicar.
// Biblioteca de guías de terceros (Meta Ads, marketing, ventas): cada agente lee solo sus áreas, a demanda.
const CONOCIMIENTO_DIR = path.join(import.meta.dirname, 'conocimiento');
const AREAS_POR_AGENTE = { media: ['meta-ads', 'marketing'], analista_pauta: ['meta-ads'], auditor: ['meta-ads', 'marketing', 'ventas'], estratega: ['meta-ads', 'marketing'], guionista: ['marketing'], viralidad: ['marketing'], community: ['marketing'], gerente_ventas: ['ventas', 'marketing'] };
const areasDe = (agent) => (agent.coordinator ? ['meta-ads', 'marketing', 'ventas'] : AREAS_POR_AGENTE[agent.id] || []);
function leerGuia(agent, archivo) {
  const areas = areasDe(agent);
  if (!archivo) return areas.map((a) => `# Área: ${a}\n${fs.readFileSync(path.join(CONOCIMIENTO_DIR, a, '_COMO-USAR.md'), 'utf8')}`).join('\n\n---\n\n');
  const [area, nombre] = String(archivo).replace(/\\/g, '/').split('/');
  if (!areas.includes(area) || !nombre || !/^[\w.-]+\.md$/.test(nombre)) return `No existe "${archivo}" en tus áreas (${areas.join(', ')}). Pedí las guías sin archivo para ver el índice.`;
  const f = path.join(CONOCIMIENTO_DIR, area, nombre);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : `No existe "${archivo}". Pedí las guías sin archivo para ver el índice.`;
}
const VIDEO_TOOLS = ['mcp__oficina__ver_video', 'mcp__oficina__leer_video', 'mcp__oficina__ver_biblioteca'];
function videoTools(agent) {
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  return [
    tool('ver_video', 'Mira un video (link de YouTube, TikTok, Instagram, Facebook, o un archivo que Diego mandó por WhatsApp) y devuelve su resumen, ideas clave, cómo aplicarlo en Cresova, estructura, lo que se ve y por qué funciona. Queda guardado en la biblioteca. Tarda 1 a 5 minutos.', {
      url: z.string().optional().describe('Link del video'),
      archivo: z.string().optional().describe('Nombre del archivo que mandó Diego por WhatsApp (aparece en su mensaje)'),
      foco: z.string().optional().describe('Qué quiere sacar Diego de este video, si lo dijo'),
    }, async ({ url, archivo, foco }) => {
      try {
        setAgent(agent.id, { status: 'working', text: 'Mirando un video…' });
        const r = await verVideo({ url, archivo, foco, por: agent.id });
        return text(`Video ${r.yaEstaba ? 'ya visto antes' : 'visto'} · id ${r.id}\n\n${fichaSinTranscripcion(r.ficha)}`);
      } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }),
    tool('leer_video', 'Relee la ficha completa de un video de la biblioteca (con la transcripción textual).', { id: z.string() },
      async ({ id }) => text(leerFicha(id) || 'No está en la biblioteca.')),
    tool('ver_biblioteca', 'Lista los videos que ya vio el equipo (id, título, canal y resumen).', {},
      async () => text(listaBiblioteca().slice(0, 40).map((v) => `- ${v.id} · ${v.titulo}${v.canal ? ` (${v.canal})` : ''}: ${v.resumen.slice(0, 200)}`).join('\n') || 'Todavía no hay videos.')),
    ...(agent.coordinator ? [tool('replicar_video', 'Encarga a Marketing variantes de un video ganador que mandó Diego (primero hay que verlo con ver_video). Mateo escribe las variantes adaptadas a Cresova, Nico elige y los editores las producen con prioridad; llegan al Estudio para que Diego las apruebe.', {
      id: z.string().describe('id del video en la biblioteca'),
      variantes: z.number().int().min(1).max(5).optional().describe('Cuántos videos producir (por defecto 3)'),
      notas: z.string().optional().describe('Indicaciones de Diego: rubros, ángulo, qué mantener o cambiar'),
    }, async ({ id, variantes = 3, notas }) => {
      const ficha = leerFicha(id);
      if (!ficha) return { content: [{ type: 'text', text: 'Ese video no está en la biblioteca: primero miralo con ver_video.' }], isError: true };
      const titulo = listaBiblioteca().find((v) => v.id === id)?.titulo || 'video de referencia';
      const r = encargarReplica({ videoId: id, titulo, ficha: fichaSinTranscripcion(ficha), variantes, notas });
      return text(`Réplica encargada (${r.variantes} variantes). Mateo las escribe, Nico elige y pasan a producción con prioridad.${r.enEspera ? ` ${r.enEspera}` : ''}`);
    }),
    tool('video_prioridad', 'Le da prioridad a un video que YA está en la cola de producción: sale antes que el resto y aunque la línea haya llegado al tope del día. Usala en vez de crearle una tarea a Lucía para producir algo que ya está en cola (eso lo produciría dos veces). Los ids están en el estado de la línea.', {
      id: z.string().describe('id (o sus primeros 8 caracteres) del video en la cola'),
      anuncio: z.boolean().optional().describe('true si es un video para pauta en Meta'),
    }, async ({ id, anuncio }) => {
      try { const q = priorizar(id, { tipo: anuncio ? 'anuncio' : undefined }); return text(`Listo: "${q.title}" sale con prioridad.`); }
      catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
    })] : []),
  ];
}

// Recordatorios: Diego le pide a Jarvis "mañana revisemos X" y Jarvis lo agenda; a esa hora
// se despierta solo, hace lo que haga falta y le escribe por WhatsApp.
const REMINDER_TOOLS = ['mcp__oficina__programar_recordatorio', 'mcp__oficina__ver_recordatorios', 'mcp__oficina__cancelar_recordatorio'];
const hnFecha = (t) => new Intl.DateTimeFormat('es-HN', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(t);
function reminderTools() {
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  state.programados ||= [];
  return [
    tool('programar_recordatorio', 'Agenda algo para más tarde: a esa hora te despertás solo, hacés lo que haga falta (revisar datos, investigar, preparar algo) y le escribís a Diego por WhatsApp. Usalo cuando Diego diga "mañana…", "el lunes…", "en dos horas…", "recordame…" o deje algo pendiente para después.', {
      cuando: z.string().describe('Fecha y hora de Honduras en formato AAAA-MM-DD HH:MM (24 h). Si Diego no dijo hora, usá 08:00.'),
      asunto: z.string().max(140).describe('Qué es, en pocas palabras. Ej.: "Revisar por qué las vistas de TikTok bajan de 100"'),
      que_hacer: z.string().max(3000).describe('Todo el contexto que vas a necesitar en ese momento: qué pidió Diego, con sus palabras, qué revisar o preparar antes de escribirle, y qué decirle o preguntarle.'),
    }, async ({ cuando, asunto, que_hacer }) => {
      const m = String(cuando).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
      if (!m) return { content: [{ type: 'text', text: 'Formato de fecha inválido: usá AAAA-MM-DD HH:MM.' }], isError: true };
      const at = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00-06:00`);
      if (!(at > Date.now() + 30e3)) return { content: [{ type: 'text', text: 'Esa hora ya pasó: elegí una futura.' }], isError: true };
      if (at > Date.now() + 90 * 86400e3) return { content: [{ type: 'text', text: 'Máximo 90 días adelante.' }], isError: true };
      const pedido = hnFecha(Date.now());
      const item = { id: randomUUID().slice(0, 8), agentId: 'coordinador', tipo: 'recordatorio', titulo: asunto, at, ts: Date.now(),
        instruction: `RECORDATORIO que Diego te pidió el ${pedido}: **${asunto}**.\n\n${que_hacer}\n\nAhora es el momento. Hacé primero lo que haga falta (revisá datos con tus herramientas, mirá el tablero o la biblioteca; si es trabajo grande, creá la tarea para quien corresponda) y después escribile a Diego con \`mcp__oficina__whatsapp_a_diego\` y **recordatorio: true**: qué encontraste, qué proponés o la pregunta concreta. Corto y en formato de WhatsApp. Al final entregá un informe breve con lo que hiciste.` };
      state.programados.push(item);
      saveNow();
      log('coordinador', `Recordatorio para el ${hnFecha(at)}: ${asunto}`, 'info');
      return text(`Agendado para el ${hnFecha(at)} (id ${item.id}).`);
    }),
    tool('ver_recordatorios', 'Lista los recordatorios y encargos pendientes, con su id y fecha.', {}, async () => {
      const list = state.programados.filter((p) => !p.hecho).sort((a, b) => a.at - b.at);
      return text(list.length ? list.map((p) => `- ${p.id.slice(0, 8)} · ${hnFecha(p.at)} · ${p.titulo}`).join('\n') : 'No hay recordatorios pendientes.');
    }),
    tool('cancelar_recordatorio', 'Cancela un recordatorio pendiente por su id (cuando Diego dice que ya no hace falta o lo resolvieron antes).', { id: z.string() }, async ({ id }) => {
      const p = state.programados.find((x) => !x.hecho && x.id.startsWith(String(id).trim()));
      if (!p) return { content: [{ type: 'text', text: 'No encontré ese recordatorio.' }], isError: true };
      p.hecho = Date.now(); p.cancelado = true;
      saveNow();
      log('coordinador', `Recordatorio cancelado: ${p.titulo}`, 'info');
      return text(`Cancelado: ${p.titulo}.`);
    }),
  ];
}

// Cuando un compañero entrega una tarea que Jarvis encargó (casi siempre a pedido de Diego),
// Jarvis se despierta y se lo manda a Diego por WhatsApp. Si llegan varias juntas, va un solo mensaje.
function avisarAJarvis(task, agent, d) {
  if (!task || task.createdBy !== 'coordinador') return;
  state.programados ||= [];
  const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
  // De noche no: queda para las 7:00.
  const at = h >= 7 && h < 21 ? Date.now() + 60e3 : (() => { const t = new Date(Date.now() - 6 * 3600e3); if (h >= 21) t.setUTCDate(t.getUTCDate() + 1); t.setUTCHours(7, 0, 0, 0); return t.getTime() + 6 * 3600e3; })();
  const linea = `- ${agent.nombre} entregó "${d.title}" (entregable ${d.id.slice(0, 8)}) para la tarea "${task.title}".`;
  const prev = state.programados.find((p) => p.tipo === 'reenvio' && !p.hecho);
  if (prev) { prev.lineas.push(linea); prev.instruction = reenvioTexto(prev.lineas); saveNow(); return; }
  state.programados.push({ id: randomUUID().slice(0, 8), agentId: 'coordinador', tipo: 'reenvio', titulo: 'Reenviar a Diego lo que entregó el equipo', at, ts: Date.now(), lineas: [linea], instruction: reenvioTexto([linea]) });
  saveNow();
}
const reenvioTexto = (lineas) => `Llegó trabajo de tareas que vos encargaste (a pedido de Diego):\n${lineas.join('\n')}\n\nLeé cada entregable con \`mcp__oficina__leer_entregable\` y mandale a Diego UN solo WhatsApp con \`mcp__oficina__whatsapp_a_diego\`, **recordatorio: true** y **adjuntar** con el id del entregable principal (le llega el PDF): por cada uno, lo principal en 2 o 3 líneas, qué se va a hacer y si necesita decidir algo (si no, que el equipo sigue con lo establecido). Formato de WhatsApp, corto. No crees tareas nuevas salvo que el entregable lo pida. Al final entregá un informe de una línea diciendo qué le mandaste.`;

function learningTools(agent) {
  return [
    tool('investigar_youtube', 'Busca los Shorts más vistos sobre un tema en un país y período (YouTube Data API). Devuelve título, canal, vistas, likes, comentarios, fecha y enlace, ordenados por vistas. Sirve para encontrar ángulos que ya funcionan en otros países.',
      {
        busqueda: z.string().describe('Palabras clave, por ejemplo "página web para negocios" o "agente de IA whatsapp"'),
        pais: z.string().length(2).describe('Código de país: MX, CO, AR, ES, US, CL, PE, HN…'),
        dias: z.number().int().min(1).max(365).optional().describe('Solo videos publicados en los últimos N días (por defecto 90)'),
        idioma: z.string().optional().describe('Idioma de los resultados, por defecto es'),
      },
      async ({ busqueda, pais, dias = 90, idioma = 'es' }) => {
        try {
          const rows = await searchShorts({ q: busqueda, region: pais.toUpperCase(), days: dias, lang: idioma });
          setAgent(agent.id, { status: 'tool', text: `YouTube ${pais.toUpperCase()}: ${busqueda}`, tool: 'WebSearch' });
          return text(rows.length ? rows.map((r, i) => `${i + 1}. ${r.title} — ${r.channel} · ${r.views.toLocaleString('es')} vistas · ${r.likes.toLocaleString('es')} likes · ${r.comments} comentarios · ${r.published} · ${r.url}`).join('\n') : 'Sin resultados para esa búsqueda.');
        } catch (e) {
          return fail(e.message);
        }
      }),
    tool('actualizar_manual', 'Guarda una versión nueva y COMPLETA del Manual de contenido (Markdown), con los aprendizajes de la semana. La versión anterior queda en el historial y Diego puede volver a ella. Mantené la estructura de secciones y agregá una línea al Registro de cambios.',
      { contenido: z.string().min(200).describe('El manual completo, no solo los cambios'), resumen: z.string().describe('Qué cambió y por qué, en una o dos frases') },
      async ({ contenido, resumen }) => {
        try {
          saveText('manual', null, contenido, agent.id);
          log(agent.id, `Actualizó el manual: ${resumen}`, 'deliverable');
          return text('Manual guardado. Todo el equipo lo usa desde su próximo trabajo.');
        } catch (e) {
          return fail(e.message);
        }
      }),
  ];
}

// Herramientas del Gerente de Ventas: leer lo que hizo el vendedor y mejorarlo.
// Negocio (base propia de Cresova): cotizaciones, cobros, gastos, clientes, pendientes y analíticas.
// Reemplazan a las herramientas del MCP de cresova.com, que desde el corte (3 nov 2026) tiene datos viejos.
const NEGOCIO_LECTURA = ['negocio_cotizaciones', 'negocio_cotizacion', 'negocio_tesoreria', 'negocio_gastos', 'negocio_clientes', 'negocio_cliente', 'negocio_pendientes', 'negocio_analiticas', 'negocio_prospeccion'];
// Lo que el MCP de cresova.com ya no debe darles: los datos de negocio viven en la base propia.
// Siguen permitidos el blog, las imágenes y la información pública de la empresa.
const CRESOVA_MCP_VIEJO = ['assign_developer', 'complete_task', 'create_client', 'create_expense', 'create_quote', 'create_task', 'delete_task', 'get_client', 'get_payroll_summary',
  'get_project', 'get_quote', 'get_sales_summary', 'get_seller_performance', 'get_treasury_summary', 'list_clients', 'list_developers', 'list_expense_categories', 'list_expenses',
  'list_fixed_costs', 'list_payroll', 'list_projects', 'list_quote_products', 'list_quotes', 'list_task_assignees', 'list_tasks', 'list_team_members', 'list_treasury_accounts',
  'mark_expense_paid', 'move_task', 'record_payroll_payment', 'register_quote_payment', 'update_client', 'update_project_brief', 'update_project_status', 'update_quote_status', 'update_task']
  .map((t) => `mcp__cresova__${t}`);
// Diego (10 nov): publicar lo decide el sistema con reglas fijas, nunca un agente. Los agentes solo leen Upload-Post.
const UPLOADPOST_ESCRITURA = ['upload_video', 'upload_photos', 'upload_text', 'upload_document', 'cancel_scheduled', 'edit_scheduled', 'retry_post', 'unpublish_post', 'update_queue_settings', 'create_media_upload', 'complete_media_upload', 'submit_ffmpeg_job', 'create_user', 'delete_user']
  .map((t) => `mcp__uploadpost__${t}`);
const conNegocio = (agent) => agent.coordinator || agent.sales || agent.prospeccion || agent.auditor || ['media', 'estratega', 'guionista'].includes(agent.id);

function negocioTools(agent) {
  const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
  const db = async () => {
    const m = await import('./cresova/db.mjs');
    if (!m.configurado()) throw new Error('La base de Cresova no está conectada.');
    return import('./cresova/negocio.mjs');
  };
  const envolver = (fn) => async (args) => { try { return text(await fn(await db(), args)); } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } };
  const L = (n) => Math.round(Number(n || 0));
  const tools = [
    tool('negocio_cotizaciones', 'Cotizaciones de Cresova (base propia, datos al día): indicadores del Cotizador (pendientes de respuesta, aprobado este mes vs el anterior, tasa de cierre, cobrado, por cobrar) y la lista filtrada por estado o búsqueda. Montos en lempiras.',
      { estado: z.enum(['all', 'draft', 'sent', 'accepted', 'rejected', 'expired']).optional(), buscar: z.string().optional(), limite: z.number().int().max(200).optional() },
      envolver(async (n, { estado = 'all', buscar = '', limite = 40 }) => {
        const r = await n.cotizaciones({ estado, buscar });
        return { indicadores: r.kpis, porEstado: r.porEstado, cotizaciones: r.lista.slice(0, limite).map((c) => ({ id: c.id, numero: c.quote_number, cliente: c.client_company || c.client_name, telefono: c.client_phone, estado: c.status, etapa: c.project_status, total: L(c.total_hnl), pagado: L(c.pagado), saldo: L(c.saldo), creada: String(c.created_at).slice(0, 10), vendedor: c.vendedor })) };
      })),
    tool('negocio_cotizacion', 'Detalle de una cotización (por id): conceptos, pagos, saldo, cliente, etapa del proyecto, notas y brief.', { id: z.string() },
      envolver(async (n, { id }) => {
        const c = await n.cotizacion(id);
        if (!c) throw new Error('No existe esa cotización.');
        return { numero: c.quote_number, estado: c.status, etapa: c.project_status, cliente: c.cliente || { nombre: c.client_name, empresa: c.client_company, telefono: c.client_phone }, conceptos: c.items.map((i) => ({ nombre: i.name, cobro: i.billing, cantidad: Number(i.quantity), precio: Number(i.unit_price) })), total: L(c.total_hnl || c.total), pagado: L(c.pagado), saldo: L(c.saldo), pagos: c.pagos.map((p) => ({ fecha: String(p.paid_at).slice(0, 10), monto: L(p.amount), cuenta: p.cuenta })), demo: c.demo_url, notas: c.notes, brief: c.dev_brief };
      })),
    tool('negocio_tesoreria', 'Tesorería de Cresova para un período (por defecto el mes actual): ingresos (pagos de clientes), gastos pagados, utilidad, por cobrar, por pagar, publicidad de Cresova, saldo por cuenta, últimos 6 meses y gastos por categoría.',
      { desde: z.string().optional().describe('AAAA-MM-DD'), hasta: z.string().optional().describe('AAAA-MM-DD') },
      envolver(async (n, a) => {
        const r = await n.tesoreria(a);
        return { periodo: `${r.desde} a ${r.hasta}`, ingresos: L(r.ingresos), gastos: L(r.gastos), utilidad: L(r.utilidad), porCobrar: L(r.por_cobrar), porPagar: L(r.por_pagar), publicidadCresova: L(r.publicidad), saldoTotal: L(r.saldo), cuentas: r.cuentas.map((c) => ({ cuenta: c.name, saldo: L(c.saldo) })), meses: r.meses, porCategoria: r.porCategoria, pagosSinCuenta: r.sinCuenta, gastosSinCategoria: r.sinCategoria };
      })),
    tool('negocio_gastos', 'Lista de gastos de Cresova con filtros (fechas, estado, texto, solo sin categoría).',
      { desde: z.string().optional(), hasta: z.string().optional(), estado: z.enum(['paid', 'pending']).optional(), buscar: z.string().optional(), sin_categoria: z.boolean().optional() },
      envolver(async (n, a) => (await n.gastos({ desde: a.desde, hasta: a.hasta, estado: a.estado || '', buscar: a.buscar || '', sinCategoria: Boolean(a.sin_categoria) }))
        .slice(0, 80).map((g) => ({ fecha: String(g.paid_at || g.expense_date).slice(0, 10), descripcion: g.description, proveedor: g.vendor, categoria: g.categoria, monto: L(g.amount_hnl), estado: g.status, origen: g.source })))),
    tool('negocio_clientes', 'Busca clientes de Cresova (nombre, negocio, teléfono o rubro) con cuántas cotizaciones tienen, cuánto se les vendió y cuánto pagaron.',
      { buscar: z.string().optional(), estado: z.enum(['lead', 'active', 'paused', 'closed']).optional() },
      envolver(async (n, a) => (await n.clientes({ buscar: a.buscar || '', estado: a.estado || '' }))
        .slice(0, 50).map((c) => ({ id: c.id, nombre: c.business_name || c.name, contacto: c.name, telefono: c.phone, rubro: c.sector, estado: c.status, cotizaciones: c.cotizaciones, vendido: L(c.vendido), pagado: L(c.pagado) })))),
    tool('negocio_cliente', 'Ficha de un cliente (por id): datos, cotizaciones con su pago y pendientes.', { id: z.string() },
      envolver(async (n, { id }) => { const c = await n.cliente(id); if (!c) throw new Error('No existe ese cliente.'); return c; })),
    tool('negocio_pendientes', 'Pendientes (tareas de personas, sobre todo de Diego) de la base de Cresova. Las vencidas primero.', { estado: z.enum(['pending', 'done', 'all']).optional() },
      envolver(async (n, { estado = 'pending' }) => (await n.tareas({ estado }))
        .slice(0, 80).map((t) => ({ id: t.id, titulo: t.title, vence: t.due_date ? String(t.due_date).slice(0, 10) : null, prioridad: t.priority, estado: t.status, cliente: t.cliente || t.cliente_nombre, cotizacion: t.quote_number })))),
    tool('negocio_analiticas', 'Analíticas de ventas por mes (cohortes por primera cotización): clientes, demos, ventas, demo→venta, vendido, cobrado, publicidad y costo por venta; tiempos promedio y motivos de rechazo.',
      { meses: z.number().int().min(1).max(24).optional() },
      envolver(async (n, { meses = 6 }) => n.analiticas({ meses }))),
    tool('negocio_prospeccion', 'Prospección (negocios que Cresova busca en Google Maps y contacta por un WhatsApp aparte y por correo): campañas, cuántos se encontraron, calificaron, contactaron y respondieron, envíos de hoy, estado del número, y los mejores calificados o los que respondieron. Solo lectura: aprobar o encender envíos lo hace Diego en Negocio → Prospección.',
      { campana: z.number().int().optional(), estado: z.enum(['calificado', 'aprobado', 'contactado', 'respondio', 'descartado']).optional() },
      envolver(async (_n, { campana, estado }) => {
        const pr = await import('./prospeccion/index.mjs');
        const r = await pr.resumen();
        const lista = await pr.prospectos({ campana: campana || r.campanas[0]?.id, estado: estado || 'calificado' });
        return { envios: { encendidos: r.config.activo, hoy: r.hoy, topeWhatsApp: r.config.waPorDia, topeCorreo: r.config.correoPorDia }, numeroWhatsApp: r.numero, buscador: r.maps.ok, embudoVentas: r.embudo,
          campanas: r.campanas.map((c) => ({ id: c.id, nombre: c.nombre, estado: c.estado, encontrados: c.encontrados, porEstado: c.conteo, costoIA_usd: c.costo })),
          prospectos: lista.slice(0, 25).map((p) => ({ id: p.id, nombre: p.nombre, estado: p.estado, puntaje: p.score, canal: p.canal, oportunidad: p.investigacion?.oportunidad, motivo: p.motivo, respondio: p.respondio_en })) };
      })),
  ];
  if (agent.coordinator || agent.sales) {
    tools.push(tool('negocio_crear_pendiente', 'Crea un pendiente para Diego en la base de Cresova (aparece en Negocio → Pendientes). Para cosas que una persona tiene que hacer, con fecha si la hay.',
      { titulo: z.string().max(200), vence: z.string().optional().describe('AAAA-MM-DD'), prioridad: z.enum(['high', 'medium', 'low']).optional(), notas: z.string().max(1000).optional() },
      envolver(async (n, a) => {
        const r = await n.guardarTarea(null, { title: a.titulo, due_date: a.vence || null, priority: a.prioridad || 'medium', notes: a.notas || null });
        log(agent.id, `Creó un pendiente: ${a.titulo}`, 'info');
        return { ok: true, id: r.id };
      })));
  }
  if (agent.coordinator) {
    tools.push(tool('negocio_cotizacion_pdf', 'Arma la propuesta en PDF, con diseño de Cresova, de una cotización y se la manda a Diego por Discord para que la revise y se la pase al cliente. No le manda nada al cliente.',
      { cotizacion: z.string().min(3).describe('Número (COT-2026-0207) o id') },
      envolver(async (_n, a) => {
        const cdb = await import('./cresova/db.mjs');
        const [c] = await cdb.q('select id, quote_number from quotes where quote_number = $1 or id::text = $1 limit 1', [a.cotizacion]);
        if (!c) return { ok: false, error: 'No existe esa cotización.' };
        const cp = await import('./cresova/cotizacion-pdf.mjs');
        const pdf = await cp.cotizacionPDF(c.id);
        const { archivoDiscord } = await import('./voz.mjs');
        await archivoDiscord(await cp.nombrePDF(c.id), Buffer.from(pdf), `Propuesta de ${c.quote_number}, lista para revisar y mandarle al cliente.`);
        return { ok: true, enviada_a: 'Discord de Diego', cotizacion: c.quote_number };
      })));
  }
  // Jarvis abre un caso desde cero cuando Diego se lo pide: cliente + cotización en borrador y, si Diego quiere, la demo.
  if (agent.coordinator) {
    const semilla = () => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'ventas', 'semilla.json'), 'utf8')).catalogo;
    tools.push(tool('negocio_crear_caso', 'Crea un cliente y su cotización en borrador en la base de Cresova y, con armar_demo, también el proyecto con su brief para que Luis arme la demo. SOLO cuando Diego lo pidió. No le escribe nada al cliente: la demo se manda después de que Diego la apruebe en la Bandeja. Armar la demo gasta cupo de Claude.',
      { negocio: z.string().min(2).max(120), telefono: z.string().min(8).max(25).describe('WhatsApp del cliente'), contacto: z.string().max(100).optional().describe('Nombre de la persona'), rubro: z.string().max(100).optional(), ciudad: z.string().max(80).optional(), paquete: z.string().max(100).optional().describe('Nombre del catálogo. Si no se indica: Web Pro'), precio: z.number().min(0).optional().describe('Solo si Diego dijo un precio distinto al del catálogo'), armar_demo: z.boolean().optional(), brief: z.string().max(4000).optional().describe('Lo que se sabe del negocio. Obligatorio con armar_demo'), repetir: z.boolean().optional().describe('true solo si Diego confirmó que quiere otra cotización para un número que ya tiene una'), pedido_por_diego: z.boolean() },
      envolver(async (_n, a) => {
        if (!a.pedido_por_diego) return { ok: false, error: 'Esta herramienta es solo para cuando Diego lo pide.' };
        const db = await import('./cresova/db.mjs');
        if (!db.enUso()) return { ok: false, error: 'La base de Cresova no está en uso.' };
        const d = String(a.telefono).replace(/\D/g, '');
        const tel = d.length === 8 ? `504${d}` : d;
        if (tel.length < 11) return { ok: false, error: 'El teléfono no es válido: pedile a Diego el número completo.' };
        if (a.armar_demo && String(a.brief || '').trim().length < 30) return { ok: false, error: 'Para armar la demo necesito un brief: a qué se dedica el negocio, qué ofrece y qué quiere lograr.' };
        const catalogo = semilla();
        const prod = catalogo.find((p) => p.nombre.toLowerCase() === String(a.paquete || 'Web Pro').toLowerCase());
        if (!prod) return { ok: false, error: `Ese paquete no está en el catálogo. Opciones: ${catalogo.map((p) => p.nombre).join(', ')}` };
        const precio = a.precio ?? Number(prod.precio || 0);
        if (!precio) return { ok: false, error: 'Este paquete se cotiza a medida: pedile el precio a Diego.' };
        const ya = await db.q("select quote_number, status from quotes where right(regexp_replace(coalesce(client_phone, ''), '\\D', '', 'g'), 8) = $1 and status <> 'rejected' order by created_at desc limit 3", [tel.slice(-8)]);
        if (ya.length && !a.repetir) return { ok: false, ya_existe: ya, error: 'Ese número ya tiene cotización. Avisale a Diego y creá otra solo si él confirma (repetir: true).' };
        const wa = await import('./ventas/whatsapp.mjs');
        const conv = a.armar_demo ? await wa.convParaTelefono(tel, a.negocio) : null;
        if (a.armar_demo && !conv) return { ok: false, error: 'Ese cliente pidió que no lo contactemos o no califica: avisale a Diego antes de armar nada.' };
        const r = await db.crearCaso({ nombre: a.contacto || a.negocio, empresa: a.negocio, telefono: `+${tel}`, rubro: a.rubro, paquete: prod.nombre, precio, descripcion: String(prod.descripcion || '').split(/\n/)[0], notas: `Creado por Jarvis a pedido de Diego.${a.brief ? `\n${a.brief}` : ''}`, sinTarea: !a.armar_demo, fuente: 'oficina' });
        log(agent.id, `Creó el caso de ${a.negocio}: ${r.numero}${a.armar_demo ? ' con demo' : ''}`, 'ok');
        if (!a.armar_demo) return { ok: true, cotizacion: r.numero, cliente: a.negocio, estado: 'borrador' };
        conv.contacto = { ...(conv.contacto || {}), empresa: a.negocio, ...(a.contacto ? { nombre: a.contacto } : {}), ...(a.rubro ? { rubro: a.rubro } : {}) };
        conv.estado.cotizacion = r.numero;
        const dev = await import('./desarrollo/proyectos.mjs');
        const p = await dev.crearProyecto({ nombre: a.negocio, rubro: a.rubro || '', ciudad: a.ciudad || '', whatsapp: tel, brief: a.brief, por: 'jarvis', origen: { conv: conv.id, cotizacion: r.numero } });
        dev.pedir(p.id, 'Armá la demo completa del sitio según el brief: decidí el diseño, escribí el contenido, generá las fotos, compilá y revisá las capturas hasta que quede excelente.').catch((e) => log('constructor', `Demo de ${p.nombre}: ${e.message}`, 'error'));
        return { ok: true, cotizacion: r.numero, proyecto: p.id, vista_previa: p.preview, nota: 'Luis ya la está armando. Le llega a Diego a la Bandeja para aprobarla antes de mandarla.' };
      })));
  }
  // Jarvis deja lista una propuesta de Agente de IA en borrador cuando Diego se lo pide.
  if (agent.coordinator) {
    tools.push(tool('negocio_propuesta_agente', 'Crea en borrador una Propuesta estratégica de Agente de IA. SOLO cuando Diego lo pidió y dijo los precios: nunca los inventes. No le manda nada al cliente; Diego la revisa en Cotizaciones.',
      { empresa: z.string().min(2).max(160), contacto: z.string().max(100).optional(), cargo: z.string().max(100).optional(), telefono: z.string().max(25).optional(), titulo: z.string().max(120).optional(), problema: z.string().min(30).max(3000).describe('Qué le pasa hoy al cliente, según lo que Diego contó'), solucion: z.string().min(30).max(3000).describe('Qué hará el agente para resolverlo'), resultados: z.array(z.string().max(200)).min(2).max(8).describe('Resultados medibles; no prometas cifras que Diego no haya dicho'), implementacion: z.number().positive().describe('Precio que dijo Diego'), mensualidad: z.number().positive().describe('Precio que dijo Diego'), conversaciones_mes: z.number().int().positive().optional(), pedido_por_diego: z.boolean() },
      envolver(async (_n, a) => {
        if (!a.pedido_por_diego) return { ok: false, error: 'Esta herramienta es solo para cuando Diego lo pide.' };
        const { PLANTILLA_AGENTE: P } = await import('./cresova/plantilla-agente.mjs');
        const neg = await import('./cresova/negocio.mjs');
        const d = structuredClone(P.datos);
        Object.assign(d, { tipo: 'agente', problem_diagnosis: a.problema, solution_summary: a.solucion, value_props: a.resultados, ...(a.titulo ? { project_title: a.titulo } : {}) });
        if (a.conversaciones_mes) d.cond_mes = d.cond_mes.replace('[cantidad]', a.conversaciones_mes.toLocaleString('en-US'));
        const items = structuredClone(P.conceptos);
        items[0].unit_price = a.implementacion; items[1].unit_price = a.mensualidad;
        const r = await neg.guardarCotizacion(null, { client_name: a.contacto || a.empresa, client_company: a.empresa, client_contact_name: a.contacto || null, client_contact_role: a.cargo || null, client_phone: a.telefono || null, currency: 'HNL', fx_rate: 1, valid_until: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), is_enterprise: true, enterprise_data: d, items });
        log(agent.id, `Armó la propuesta de agente para ${a.empresa}: ${r.quote_number}`, 'ok');
        return { ok: true, cotizacion: r.quote_number, estado: 'borrador', falta: a.conversaciones_mes ? [] : ['cantidad de conversaciones al mes'], enlace: `#/cotizaciones/${r.id}` };
      })));
  }
  // Jarvis registra plata solo después de que Diego le confirma en el chat el monto exacto y a qué va.
  if (agent.coordinator) {
    const sinConfirmar = { content: [{ type: 'text', text: 'Primero confirmale a Diego en el chat el monto exacto, la cotización o el gasto y la cuenta, y esperá su "sí". Después volvé a llamar con confirmado_por_diego: true.' }], isError: true };
    tools.push(
      tool('negocio_registrar_pago', 'Registra un pago de un cliente en una cotización (el 50 % para empezar, el resto al entregar, o un abono). Con el primer pago la cotización queda aceptada y el proyecto pasa a "Aprobado". SOLO después de que Diego confirmó en el chat el monto, la cotización y la cuenta.',
        { cotizacion_id: z.string().describe('id de negocio_cotizaciones'), monto: z.number().positive(), fecha: z.string().optional().describe('AAAA-MM-DD, por defecto hoy'), cuenta: z.string().optional().describe('nombre de la cuenta de tesorería, por ejemplo "Diego — Receptora"'), metodo: z.enum(['transfer', 'cash', 'card', 'paypal', 'other']).optional(), referencia: z.string().max(200).optional(), confirmado_por_diego: z.boolean() },
        async (a) => {
          if (!a.confirmado_por_diego) return sinConfirmar;
          try {
            const db = await import('./cresova/db.mjs');
            const ctas = await db.cuentas();
            const cta = a.cuenta ? ctas.find((c) => c.name.toLowerCase().includes(a.cuenta.toLowerCase())) : ctas.length === 1 ? ctas[0] : null;
            if (a.cuenta && !cta) return { content: [{ type: 'text', text: `No hay una cuenta que se llame "${a.cuenta}". Cuentas: ${ctas.map((c) => c.name).join(', ')}` }], isError: true };
            const p = await db.pago(a.cotizacion_id, { monto: a.monto, fecha: a.fecha, cuenta: cta?.id || null, metodo: a.metodo || 'transfer', referencia: a.referencia || '' });
            log(agent.id, `Registró un pago de L ${a.monto} en ${p.numero} (${p.empresa || p.cliente}) por pedido de Diego`, 'ok');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, cotizacion: p.numero, cliente: p.empresa || p.cliente, pagado: p.pagado, total: p.total, saldo: Math.max(0, p.total - p.pagado), etapa: p.etapa, cuenta: cta?.name || 'sin cuenta' }) }] };
          } catch (e) { return { content: [{ type: 'text', text: `No se pudo registrar: ${e.message}` }], isError: true }; }
        }),
      tool('negocio_registrar_gasto', 'Registra un gasto de Cresova (pagado o pendiente). SOLO después de que Diego confirmó en el chat el monto, el concepto y la categoría.',
        { monto: z.number().positive(), descripcion: z.string().max(300), proveedor: z.string().max(200).optional(), categoria: z.string().optional().describe('etiqueta de la categoría, por ejemplo "Dominios" o "Publicidad de Cresova"'), cuenta: z.string().optional(), fecha: z.string().optional(), moneda: z.enum(['HNL', 'USD']).optional(), tipo_cambio: z.number().positive().optional(), pendiente: z.boolean().optional(), confirmado_por_diego: z.boolean() },
        async (a) => {
          if (!a.confirmado_por_diego) return sinConfirmar;
          try {
            const db = await import('./cresova/db.mjs');
            const neg = await import('./cresova/negocio.mjs');
            const [cats, ctas] = await Promise.all([neg.categorias(), db.cuentas()]);
            const cat = a.categoria ? cats.find((c) => c.label.toLowerCase().includes(a.categoria.toLowerCase()) || c.key === a.categoria) : null;
            const cta = a.cuenta ? ctas.find((c) => c.name.toLowerCase().includes(a.cuenta.toLowerCase())) : null;
            const r = await neg.guardarGasto(null, { amount: a.monto, description: a.descripcion, vendor: a.proveedor || null, category_id: cat?.id || null, account_id: cta?.id || null, expense_date: a.fecha || undefined, currency: a.moneda || 'HNL', fx_rate: a.tipo_cambio || 1, status: a.pendiente ? 'pending' : 'paid', expense_type: cat?.key === 'ads_cresova' ? 'growth' : cat?.key === 'ads_clients' ? 'client_managed' : 'operating' });
            log(agent.id, `Registró un gasto de ${a.moneda || 'L'} ${a.monto}: ${a.descripcion}`, 'ok');
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, id: r.id, categoria: cat?.label || 'sin categoría (clasificalo en Tesorería)', cuenta: cta?.name || null }) }] };
          } catch (e) { return { content: [{ type: 'text', text: `No se pudo registrar: ${e.message}` }], isError: true }; }
        }),
    );
  }
  return tools;
}

function salesTools(agent = { nombre: "la oficina", id: "coordinador" }) {
  const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] });
  return [
    tool('cobrar_anticipo', 'Le escribe a un cliente que aceptó para cobrarle el anticipo del 50 %. El texto lo arma el sistema. Se niega sola si no corresponde y te dice por qué. Solo anticipos.', { cotizacion: z.string().describe('Número, por ejemplo COT-2026-0204') }, async ({ cotizacion }) => { try { return text(await (await import('./cresova/cobranza.mjs')).cobrarAnticipo({ cotizacion })); } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } }),
    tool('proyectos_lista', 'Las cotizaciones y proyectos de Cresova (la base real de cresova.com): por etapa (pendiente demo, demo enviada, aprobado, en progreso, esperando aprobación, terminado, entregado), con cliente, paquete, total, pagado, días en la etapa y enlace de la demo. Usalo para saber en qué va cada cliente o cuántos hay en cada etapa.', { etapa: z.string().optional().describe('Filtrar por una etapa (id: pending_demo, demo_sent, approved, in_progress, awaiting_approval, finished, delivered)'), buscar: z.string().optional().describe('Texto para buscar en cliente, empresa o número') },
      async ({ etapa, buscar }) => {
        const db = await import('./cresova/db.mjs');
        if (!db.configurado()) return text('La oficina todavía no tiene la llave de Supabase de Cresova (Sistema → Llaves): no puedo leer las cotizaciones.');
        let lista = await db.proyectos({ entregados: etapa === 'delivered' });
        if (etapa) lista = lista.filter((p) => p.etapa === etapa);
        if (buscar) { const b = buscar.toLowerCase(); lista = lista.filter((p) => `${p.cliente} ${p.empresa} ${p.numero}`.toLowerCase().includes(b)); }
        const porEtapa = Object.fromEntries(db.ETAPAS.map((e) => [e.label, lista.filter((p) => p.etapa === e.id).length]));
        return text({ porEtapa, proyectos: lista.slice(0, 80).map((p) => ({ id: p.id, numero: p.numero, cliente: p.empresa || p.cliente, telefono: p.telefono, etapa: p.etapa, paquete: p.paquete, total: p.total, pagado: p.pagado, dias_en_etapa: p.dias, demo: p.demo || null })) });
      }),
    tool('proyecto_mover', 'Mueve un proyecto de Cresova a otra etapa (por id de proyectos_lista). "demo_sent" exige el enlace de la demo. Solo cuando Diego lo pidió o cuando el hecho ya pasó (por ejemplo, el cliente aprobó).', { id: z.string(), etapa: z.enum(['pending_demo', 'demo_sent', 'approved', 'in_progress', 'awaiting_approval', 'finished', 'delivered']), demo_url: z.string().optional(), nota: z.string().max(500).optional() },
      async ({ id, etapa, demo_url, nota }) => {
        const db = await import('./cresova/db.mjs');
        if (!db.configurado()) return text('Falta la llave de Supabase de Cresova.');
        try { const p = await db.mover(id, etapa, { demoUrl: demo_url || '', nota: nota || '' }); return text({ ok: true, numero: p.numero, etapa: p.etapa }); }
        catch (e) { return { content: [{ type: 'text', text: `No se pudo mover: ${e.message}` }], isError: true }; }
      }),
    tool('ventas_resumen', 'Resumen del vendedor: modelo, costo, reglas activas, correcciones de Diego y estado de cada conversación.', {}, async () => {
      const { convs, cases, ...rest } = ventas.ventasSummary();
      return text({ ...rest, conversaciones: convs.slice(0, 40), casosReales: { total: cases.length, conDemo: cases.filter((c) => c.demo).length } });
    }),
    tool('leer_conversaciones', 'Transcripciones completas de las conversaciones del vendedor (con lo que había respondido Natally en los casos reales y las correcciones de Diego).',
      { tipo: z.enum(['todas', 'sim', 'caso', 'whatsapp']).optional(), limite: z.number().int().min(1).max(30).optional() },
      async ({ tipo, limite }) => text(ventas.transcripts({ tipo, limite }) || 'No hay conversaciones todavía.')),
    tool('leer_correcciones', 'Las últimas correcciones que Diego le hizo al vendedor (respuesta mala, cómo debió ser y por qué).', { limite: z.number().int().min(1).max(100).optional() },
      async ({ limite }) => text(ventas.feedbackList(limite || 30))),
    tool('leer_casos_velforce', 'Conversaciones reales de Cresova en Velforce (últimos 60 días) con su resultado: si terminaron en demo aceptada o no. Sirven para aprender qué funcionó.',
      { resultado: z.enum(['demo', 'sin_demo', 'todos']).optional(), desde: z.number().int().min(0).optional(), limite: z.number().int().min(1).max(15).optional() },
      async ({ resultado = 'todos', desde = 0, limite = 8 }) => {
        const all = ventas.loadCases().filter((c) => resultado === 'todos' || (resultado === 'demo') === c.demo);
        const page = all.slice(desde, desde + limite);
        const block = (c) => [
          `## ${c.demo ? 'DEMO ACEPTADA' : 'SIN DEMO'} · ${c.empresa || 'sin nombre'} · ${c.fecha}${c.anuncio ? ` · anuncio: ${c.anuncio}` : ''}`,
          ...c.mensajes.map((m) => `${m.de === 'cliente' ? 'CLIENTE' : 'NATALLY'}: ${m.texto}`),
        ].join('\n');
        return text(`${all.length} casos (${resultado}); mostrando ${desde + 1}–${desde + page.length}.\n\n${page.map(block).join('\n\n')}`);
      }),
    tool('leer_aprendizajes_velforce', 'Lo que se aprendió y corrigió del bot de Cresova en Velforce (técnico y de comportamiento).', {},
      async () => text(fs.readFileSync(path.join(import.meta.dirname, 'ventas', 'aprendizajes-velforce.md'), 'utf8'))),
    tool('leer_playbook', 'El playbook de ventas vigente (las reglas que sigue el vendedor).', {}, async () => text(ventas.getPlaybook())),
    tool('actualizar_playbook', 'Reemplaza el playbook de ventas por una versión mejorada (queda versionado y Diego puede volver atrás). Mandá el texto COMPLETO.',
      { contenido: z.string().min(500), resumen: z.string().describe('Qué cambió y por qué, en una o dos frases') },
      async ({ contenido, resumen }) => { ventas.savePlaybook(contenido, 'gerente_ventas', resumen); return text('Playbook actualizado.'); }),
    tool('crear_regla', 'Agrega una regla aprendida al vendedor, con un ejemplo de lo que hay que evitar y de lo que sí.',
      { regla: z.string(), categoria: z.string().optional(), mal: z.string().optional(), bien: z.string().optional() },
      async (a) => text(ventas.addRule(a))),
    tool('desactivar_regla', 'Desactiva una regla aprendida que ya no sirve o que empeoró los resultados.', { id: z.string() },
      async ({ id }) => text(ventas.setRule(id, false))),
    tool('probar_vendedor', 'Simula un cliente: le manda al vendedor estos mensajes, uno por turno, y devuelve la conversación. Sirve para probar un cambio antes de darlo por bueno. Cuesta créditos de OpenRouter: usalo con moderación.',
      { mensajes: z.array(z.string()).min(1).max(6), anuncio: z.string().optional(), titulo: z.string().optional() },
      async ({ mensajes, anuncio, titulo }) => {
        const conv = ventas.newConv({ title: `Prueba de Martín: ${titulo || mensajes[0].slice(0, 40)}`, anuncio: anuncio ? { titulo: anuncio } : null });
        for (const m of mensajes) await ventas.clientSays(conv.id, m);
        return text(ventas.transcripts({ tipo: 'sim', limite: 1 }));
      }),
    tool('recontacto_pausar', 'FRENO DE EMERGENCIA del recontacto: mientras esté pausado no sale ningún mensaje nuevo a clientes viejos (los chats abiertos siguen atendidos). Usalo si Diego lo pide, si hay quejas o si algo suena mal.', { motivo: z.string().max(200) },
      async ({ motivo }) => text((await import('./ventas/recontacto.mjs')).pausar(true, motivo))),
    tool('recontacto_reanudar', 'Reanuda el recontacto después de una pausa. Solo con el OK de Diego.', {},
      async () => text((await import('./ventas/recontacto.mjs')).pausar(false))),
    tool('recontacto_estado', 'Estado del recontacto: pausado o no, cuántos van por estado, ritmo de hoy y cada cliente.', {},
      async () => text((await import('./ventas/recontacto.mjs')).estadoRecontacto())),
    // Desarrollo (Luis y Ashley) no está en el tablero: se maneja por proyectos.
    tool('desarrollo_estado', 'Lista los proyectos de Desarrollo (Luis construye, Ashley revisa): estado, si están trabajando y si alguno quedó PARADO sin construirse. Usalo para saber cómo va una demo.', {},
      async () => {
        const dev = await import('./desarrollo/proyectos.mjs');
        const l = dev.listarProyectos();
        return text(l.length ? l.map((p) => `- ${p.id} · ${p.nombre} · ${p.estado}${p.trabajando ? ' · TRABAJANDO' : ''}${p.estado === 'armando' && !p.tieneBuild && !p.trabajando ? ' · PARADA (sin construir)' : ''}${p.origen?.cotizacion ? ` · ${p.origen.cotizacion}` : ''}${p.enviada ? ' · enviada al cliente' : ''}`).join('\n') : 'No hay proyectos.');
      }),
    tool('desarrollo_pedir', 'Le pide trabajo a Luis (construye y corrige páginas; Ashley revisa la calidad). Sin pedido, retoma una demo parada con su brief original. Con pedido, es un cambio sobre ese proyecto. Trabaja de a un proyecto a la vez y gasta cupo de Claude: no lo uses para probar. Nunca envía nada al cliente: eso lo aprueba Diego en la Bandeja.', { proyecto: z.string().describe('id del proyecto (de desarrollo_estado)'), pedido: z.string().max(4000).optional() },
      async ({ proyecto, pedido }) => {
        const dev = await import('./desarrollo/proyectos.mjs');
        const p = dev.getProyecto(proyecto);
        if (!p) return text('No existe ese proyecto. Mirá los ids con desarrollo_estado.');
        const pr = pedido ? dev.pedir(p.id, pedido, { por: agent.nombre, revisar: true }) : dev.reanudar(p.id);
        const pronto = await Promise.race([pr.then(() => 'listo', (e) => `error: ${e.message}`), new Promise((r) => setTimeout(() => r(null), 3000))]);
        if (pronto && pronto.startsWith('error')) return text(`No se pudo: ${pronto.slice(7)}`);
        log('constructor', `${agent.nombre} le pidió trabajo a Luis en ${p.nombre}`, 'info');
        return text(`Luis empezó con ${p.nombre}. Tarda unos minutos; después Ashley lo revisa y aparece la tarjeta "Demo lista" en la Bandeja.`);
      }),
    // Recontacto de cotizaciones que quedaron pendientes.
    tool('recontacto_cargar', 'Trae del sistema Cresova todas las cotizaciones enviadas o en borrador que no se aprobaron (las que dejó el equipo a medias) y las suma a la lista de recontacto. Deduplica por teléfono.', {},
      async () => text(await (await import('./ventas/recontacto.mjs')).cargar())),
    tool('recontacto_lista', 'Lista de recontacto: cada cotización con cliente, teléfono, monto, si se le mandó la demo, notas de la cotización, lo hablado en la oficina con ese número (si hay) y su estado (pendiente, propuesto, aprobado, enviado, respondio, descartado).', { estado: z.enum(['pendiente', 'propuesto', 'aprobado', 'enviado', 'respondio', 'descartado']).optional() },
      async ({ estado }) => { const rc = await import('./ventas/recontacto.mjs'); return text({ resumen: rc.resumen(), items: rc.lista({ estado }) }); }),
    tool('recontacto_proponer', 'Guarda el PRIMER mensaje de WhatsApp para una cotización (corto, cálido, retoma algo concreto de ese cliente, una sola pregunta al final) y el contexto que el vendedor necesita para seguir la conversación. O descartala con el motivo (número inválido, ya dijo que no, duplicado, extranjero sin sentido, etc.).',
      { cotizacion: z.string(), mensaje: z.string().max(900).optional(), contexto: z.string().max(1500).optional(), descartar: z.string().optional().describe('Motivo para NO recontactar') },
      async (a) => text((await import('./ventas/recontacto.mjs')).proponer(a))),
    tool('recontacto_pedir_aprobacion', 'Manda a la Bandeja de Diego UN solo pedido de aprobación con todos los mensajes propuestos. Si aprueba, el vendedor los envía de a poco (máx. 10 por día, en horario) y atiende las respuestas.', {},
      async () => text((await import('./ventas/recontacto.mjs')).pedirAprobacion())),
  ];
}

function officeServer(agent, delivered, ctx = {}) {
  return createSdkMcpServer({
    name: 'oficina',
    tools: [
      tool('estado', 'Cuenta a la oficina, en una frase corta, qué estás haciendo ahora.', { texto: z.string() }, async ({ texto }) => {
        setAgent(agent.id, { status: 'working', text: texto });
        log(agent.id, texto);
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
      tool('entregar', 'Entrega tu trabajo terminado (Markdown). Llamala una vez al final. Diego solo ve como pendiente lo que es tipo "decision"; los informes los lee cuando quiere.', {
        titulo: z.string(),
        contenido: z.string(),
        tipo: z.enum(['informe', 'decision']).optional().describe('"informe" (por defecto): reportes, planes y avisos para leer. "decision": solo si Diego tiene que aprobar algo o responder una pregunta concreta para que el trabajo siga.'),
        resumen: z.string().max(400).optional().describe('2 o 3 líneas para Diego: lo importante, sin relleno. Se muestra en la tarjeta.'),
        pregunta: z.string().max(200).optional().describe('Con tipo "decision": la pregunta concreta, por ejemplo "¿Producimos estos 3 guiones?".'),
        opciones: z.array(z.string().max(40)).max(4).optional().describe('Con pregunta: 2 a 4 respuestas cortas que Diego toca con un clic, por ejemplo ["Sí", "No"]. Sin opciones, Diego aprueba o pide cambios.'),
        reemplaza: z.string().optional().describe('id de una pregunta tuya anterior, todavía sin responder, que esta reemplaza (mismo tema, propuesta actualizada)'),
      }, async ({ titulo, contenido, tipo, resumen, pregunta, opciones, reemplaza }) => {
        const kind = pregunta || (tipo === 'decision' && !ctx.taskId) ? 'decision' : 'informe';
        const extra = { kind, ...(ctx.taskId ? { taskId: ctx.taskId } : {}), ...(ctx.conDiego && !agent.coordinator ? { pedidoDiego: true } : {}) };
        if (resumen) extra.summary = resumen.trim();
        if (kind === 'decision' && pregunta) extra.question = pregunta.trim();
        if (kind === 'decision' && pregunta && opciones?.length >= 2) extra.options = opciones.map((o) => o.trim()).filter(Boolean);
        const d = addDeliverable(agent.id, titulo, contenido, extra);
        delivered.push(d);
        // Una pregunta nueva sobre el mismo tema reemplaza a la vieja: en la Bandeja queda una sola.
        if (kind === 'decision' && !ctx.taskId) {
          const palabras = (t) => new Set(String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3));
          const nuevo = palabras(`${titulo} ${pregunta || ''}`);
          const parecido = (x) => { const v = palabras(`${x.title} ${x.question || ''}`); const comun = [...nuevo].filter((w) => v.has(w)).length; return comun / Math.max(1, Math.min(nuevo.size, v.size)) >= 0.5; };
          for (const x of listDeliverables()) {
            if (x.id === d.id || x.agentId !== agent.id || x.kind !== 'decision' || x.status !== 'pending' || x.taskId) continue;
            if ((reemplaza && x.id.startsWith(String(reemplaza).trim())) || (Date.now() - x.ts < 4 * 86400e3 && parecido(x))) {
              // Sin pasar por la revisión de Diego: no cuenta como respuesta suya ni como corrección.
              x.status = 'discarded'; x.note = `Reemplazada por: ${titulo}`; x.reemplazadaPor = d.id;
              const { file, content, ...pub } = x;
              broadcast({ type: 'deliverable-updated', deliverable: pub });
              saveNow();
              log(agent.id, `Reemplazó su pregunta anterior: ${x.title}`, 'info');
            }
          }
        }
        if (ctx.taskId) linkDeliverable(ctx.taskId, d.id, { terminada: kind === 'informe' });
        log(agent.id, `Entregó: ${titulo}`, 'deliverable');
        // Guiones de Mateo fuera de un lote de la línea (allí Nico ya los filtra solo): pasan a Nico sin que nadie los copie.
        // Si Mateo le pregunta a Diego cuáles producir (decisión), pasan cuando Diego contesta (server.mjs → review).
        if (agent.id === 'guionista' && d.kind !== 'decision' && sonGuiones(titulo, contenido) && !/^(línea de producción|réplica)/i.test(ctx.reason || '')) {
          guionesANico(d, { tareaOrigen: ctx.taskId ? getTask(ctx.taskId) : null })
            .then((t) => log('guionista', `Los guiones pasaron solos a Nico: ${t.title}`, 'info'))
            .catch((e) => log('guionista', `No se pudieron pasar los guiones a Nico: ${e.message}`, 'error'));
        }
        if (ctx.taskId && !agent.coordinator) avisarAJarvis(getTask(ctx.taskId), agent, d);
        for (const other of getAgents().filter((a) => a.inputs.includes(agent.id))) {
          broadcast({ type: 'handoff', from: agent.id, to: other.id, title: titulo });
        }
        return { content: [{ type: 'text', text: kind === 'decision' ? 'Entregado. Diego lo tiene en su Bandeja para decidir.' : 'Informe guardado. Diego lo lee cuando quiera.' }] };
      }),
      tool('recordar_indicacion', 'Guarda una indicación permanente de Diego para que el equipo la aplique siempre (entra en las instrucciones de quien corresponda).',
        { indicacion: z.string().describe('La indicación, clara y en una frase, por ejemplo: "La demo se entrega al día siguiente; nunca decir 24 a 48 horas".'),
          para: z.string().optional().describe('A quién aplica: "todos" (por defecto), "marketing", "ventas", o el id de un agente (vendedor, guionista, video, estratega, community, viralidad, media, gerente_ventas, coordinador).') },
        async ({ indicacion, para }) => {
          const m = remember({ indicacion, para: para || 'todos', por: agent.id, origen: 'chat' });
          return { content: [{ type: 'text', text: `Guardada (${m.para}). Desde ahora entra en las instrucciones.` }] };
        }),
      ...(agent.coordinator ? [tool('whatsapp_a_diego', 'Le manda un WhatsApp a Diego (desde el número de ventas). Por tu cuenta, solo para algo importante: máximo 3 por día y nunca de noche. Para cumplir un recordatorio que Diego pidió, usá recordatorio: true (no cuenta en ese tope).',
        { mensaje: z.string().max(1500), recordatorio: z.boolean().optional().describe('true si estás cumpliendo un recordatorio o encargo que Diego programó, O si Diego te pidió expresamente que le escribas (por chat, WhatsApp o voz). El tope de 3 avisos al día y el horario nocturno son solo para avisos que mandás por tu cuenta'), adjuntar: z.string().optional().describe('id de un entregable para mandarle también su documento en PDF') },
        async ({ mensaje, recordatorio, adjuntar }) => {
          const { messageOwner } = await import('./ventas/whatsapp.mjs');
          let pdf = null;
          if (adjuntar) { const d = state.deliverables.find((x) => x.id.startsWith(String(adjuntar).trim())); if (d) { const docs = await import('./documentos.mjs'); const b = await docs.docPDF(d.id).catch(() => null); if (b) pdf = { base64: b.toString('base64'), fileName: docs.nombreArchivo(d.id) }; } }
          const r = await messageOwner(mensaje, { recordatorio: Boolean(recordatorio), pdf }).catch((e) => ({ ok: false, error: e.message }));
          return { content: [{ type: 'text', text: r.ok ? 'Enviado a Diego por WhatsApp.' : `No se envió: ${r.error}` }] };
        }),
        tool('ver_bandeja', 'Lee lo que está esperando a Diego en la Bandeja de la oficina: decisiones pendientes (con quién las pidió y la pregunta), videos por aprobar, permisos y cuántos informes hay sin leer. Usala cuando Diego pregunte qué tiene pendiente o antes de resumírselo. Pasá completo=true para el detalle largo (por ejemplo, para mandárselo por escrito).', { completo: z.boolean().optional() },
          async ({ completo }) => {
            const prom = (await import('./ventas/whatsapp.mjs')).promesasPendientes();
            const extra = prom.length ? `\n\nPROMESAS A CLIENTES SIN CUMPLIR (${prom.length}):\n${prom.map((p) => `- ${p.cliente} (+${p.telefono}), hace ${p.hace_horas} h: "${p.promesa}"${p.cliente_escribio_despues ? ` · después escribió: "${p.cliente_escribio_despues}"` : ''}`).join('\n')}` : '';
            return { content: [{ type: 'text', text: (await import('./voz.mjs')).bandejaTexto({ completo: Boolean(completo) }) + extra }] };
          }),
        tool('discord_a_diego', 'Le manda un mensaje privado a Diego por Discord (desde el bot Jarvis | Cresova). Sirve para resúmenes largos, listas o algo que quiera reenviar, porque Discord admite textos largos y muestra Markdown: escribilo con títulos ## , **negritas** y listas con - (sin tablas). Si Diego te pidió que le escribas, mandalo siempre; por tu cuenta, solo si es importante y nunca de noche.', { mensaje: z.string().max(8000), pedido_por_diego: z.boolean().optional().describe('true si Diego te pidió expresamente que se lo mandes') },
          async ({ mensaje, pedido_por_diego }) => {
            const h = new Date(Date.now() - 6 * 3600e3).getUTCHours();
            if (!pedido_por_diego && (h < 7 || h >= 21)) return { content: [{ type: 'text', text: 'Es de noche en Honduras: dejalo para mañana.' }] };
            try { await (await import('./voz.mjs')).mensajeDiscord(mensaje); log('coordinador', 'Le escribió a Diego por Discord', 'info'); return { content: [{ type: 'text', text: 'Enviado a Diego por Discord.' }] }; }
            catch (e) { return { content: [{ type: 'text', text: `No se envió: ${e.message}` }] }; }
          }),
        ...reminderTools()] : []),
      ...(conNegocio(agent) ? negocioTools(agent) : []),
      ...(agent.pauta || agent.auditor ? (() => {
        const pa = () => import('./pauta/index.mjs');
        const txt = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
        const ok = (fn) => async (a) => { try { return txt(await fn(a)); } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } };
        return [
          tool('pauta_tablero', 'Tablero del departamento: por anuncio, el GASTO en Meta cruzado con lo que pasó de verdad: leads, calificados / dudosos / basura (con motivos), demos, cotizaciones, ventas e ingresos, y los costos por lead calificado, por demo y por venta. Más el estado de las señales a Meta y la bitácora. Es tu fuente de verdad.', { dias: z.number().int().min(1).max(90).optional() },
            ok(async ({ dias = 30 }) => (await pa()).tablero(dias))),
          tool('bitacora_leer', 'Bitácora de pruebas de pauta: tests en curso, los que ya hay que revisar (pasó su fecha), la calibración del equipo (cuántas predicciones se acertaron) y los aprendizajes acumulados. Leela ANTES de proponer algo para no repetir lo que ya falló.', { estado: z.enum(['en curso', 'cerrado', 'registrado']).optional() },
            ok(async (a) => (await pa()).leer(a))),
          ...(agent.id === 'media' ? [tool('pedir_anuncio', 'Le encarga un anuncio nuevo al equipo creativo con un brief estructurado: Mateo escribe 3 ejecuciones del MISMO concepto (test 3:2:2), Nico da su veredicto y los editores lo producen con prioridad. Queda en el pipeline de anuncios del tablero (brief → guion → edición → revisión → en Meta → medido). Usalo cuando falte un Ring, un anuncio esté cansado o uno traiga basura.',
            { ring: z.enum(['R1', 'R2', 'R3', 'R4', 'R5']), concepto: z.string().max(200), hipotesis: z.string().max(600), prediccion: z.string().max(300).describe('En números: qué esperás que pase y en cuántos días'),
              gancho: z.string().max(300), texto_a: z.string().max(600), texto_b: z.string().max(600), titular_a: z.string().max(120), titular_b: z.string().max(120),
              formato: z.string().max(200).describe('Ej.: video 9:16 de 20-30 s, UGC de dueño de negocio, demo de pantalla'), filtro_calidad: z.string().max(300).describe('Cómo filtra curiosos o gente sin negocio'), referencia: z.string().max(300).optional() },
            ok(async (a) => (await pa()).pedirAnuncio(a))),
          tool('bitacora_registrar', 'Anota en la bitácora un test que propusiste (o un cambio o un aprendizaje). En un test es OBLIGATORIO poner la hipótesis y la predicción en números (ej.: "el costo por lead calificado baja de L 180 a L 140") y en cuántos días se revisa.',
            { tipo: z.enum(['test', 'cambio', 'aprendizaje']), titulo: z.string().max(160), hipotesis: z.string().max(600).optional(), prediccion: z.string().max(300).optional(), metrica: z.string().max(120).optional(), revisar_en_dias: z.number().int().min(1).max(60).optional(), anuncios: z.array(z.string()).max(10).optional() },
            ok(async (a) => (await pa()).registrar({ ...a, por: 'Renata' })))] : []),
          ...(agent.id !== 'calidad_leads' && !agent.auditor ? [tool('bitacora_cerrar', 'Cierra un test de la bitácora con el resultado real (números), el aprendizaje en una frase (qué haríamos distinto) y si la predicción se cumplió.', { id: z.string(), resultado: z.string().max(600), aprendizaje: z.string().max(600), acerto: z.boolean().optional() },
            ok(async (a) => (await pa()).cerrar(a)))] : []),
          ...(agent.id === 'calidad_leads' ? [
            tool('leads_sin_clasificar', 'Leads de WhatsApp (la mayoría de anuncios) que todavía no tienen calidad asignada, con sus primeros mensajes y lo que pasó (vio precio, pidió demo).', { dias: z.number().int().min(1).max(30).optional(), limite: z.number().int().min(1).max(40).optional() },
              ok(async (a) => (await pa()).leadsSinClasificar(a))),
            tool('clasificar_lead', 'Marca la calidad de un lead. calificado = dueño o encargado de un negocio real que quiere una página y puede pagarla (aunque todavía no compre). dudoso = no hay suficiente para saber. basura = no es cliente posible: elegí el motivo.',
              { conv_id: z.string(), nivel: z.enum(['calificado', 'dudoso', 'basura']), motivo: z.enum(['curioso', 'empleo', 'busca algo gratis', 'otro país', 'sin negocio', 'presupuesto muy bajo', 'otro servicio', 'competencia', 'no respondió', 'otro']).optional(), rubro: z.string().max(60).optional(), nota: z.string().max(300).optional() },
              ok(async (a) => (await pa()).clasificar(a))),
          ] : []),
        ];
      })() : []),
      ...(agent.prospeccion ? [
        tool('prospeccion_resultados', 'Resultados de todas las campañas de prospección: encontrados, calificados, contactados por canal, respondieron, no quieren, tasa de respuesta, demos y ventas en Ventas, costo de IA, ángulo usado, y las últimas respuestas de los negocios. Es tu fuente de verdad.', {},
          async () => { try { return { content: [{ type: 'text', text: JSON.stringify(await (await import('./prospeccion/index.mjs')).resultados(), null, 1) }] }; } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } }),
        tool('prospeccion_sondeo', 'Sondeo rápido en Google Maps (tarda 1 a 5 minutos, sin costo de IA y sin guardar nada): cuántos negocios aparecen para unas búsquedas, qué % no tiene página, cuántos tienen celular o correo, cuántos ya son contactos de Cresova, categorías y ejemplos. Usalo para medir cada idea antes de proponerla.',
          { busquedas: z.array(z.string()).min(1).max(5).describe('Como se buscaría en Maps, con la ciudad: "clínica dental Tegucigalpa"') },
          async ({ busquedas }) => { try { return { content: [{ type: 'text', text: JSON.stringify(await (await import('./prospeccion/index.mjs')).sondeo(busquedas), null, 1) }] }; } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } }),
        tool('prospeccion_proponer', 'Le presenta a Diego 2 o 3 campañas en una tarjeta de la Bandeja (una opción por campaña). Cuando aprueba una, se crea sola. No hace falta usar entregar después: la tarjeta es tu entrega. Solo una propuesta pendiente a la vez.',
          { resumen: z.string().max(1500).describe('2-4 frases: qué aprendiste de lo anterior (con números) y qué cambia'),
            propuestas: z.array(z.object({
              nombre: z.string().max(80).describe('Ej.: "Clínicas dentales · Tegucigalpa"'), rubro: z.string().max(80), ciudad: z.string().max(60),
              busquedas: z.array(z.string()).min(1).max(8).describe('Búsquedas en Maps, con la ciudad'),
              angulo: z.string().max(600).describe('El problema de negocio de ese rubro y el beneficio a destacar en el primer mensaje'),
              porque: z.string().max(1200).describe('Por qué esta campaña, con datos: resultados anteriores y lo que dio el sondeo'),
              tamano: z.string().max(200).describe('Lo que dio el sondeo: cuántos, % sin página, % con celular'),
              profundidad: z.number().int().min(1).max(10).optional(),
            })).min(1).max(3) },
          async (a) => { try { return { content: [{ type: 'text', text: JSON.stringify((await import('./prospeccion/index.mjs')).proponer(a)) }] }; } catch (e) { return { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true }; } }),
      ] : []),
      ...(agent.ceo ? salesTools(agent).filter((t) => /^(ventas_resumen|leer_playbook|recontacto_estado|desarrollo_estado|proyectos_lista)$/.test(t.name)) : []),
      ...(agent.sales || agent.coordinator ? salesTools(agent).filter((t) => !agent.sales ? /recontacto_(pausar|reanudar|estado)|desarrollo_|proyecto/.test(t.name) : true) : []),
      ...(agent.id === 'viralidad' ? [
        tool('encolar_video', 'Pasa un guion aprobado por el comité a la cola de producción de Lucía (línea de producción). Una llamada por guion.', {
          titulo: z.string().describe('Título corto del video'),
          guion: z.string().describe('Guion completo y corregido: locución entre --- TEXTO PARA ELEVENLABS --- y --- FIN ---, escenas por segundo, texto en pantalla, CTA y texto de publicación'),
          base: z.string().optional().describe('Carpeta del video del que es variante, por ejemplo 25-clinica-cerro'),
          prioridad: z.boolean().optional().describe('true para réplicas o encargos directos de Diego: se producen antes que el resto'),
          tipo: z.enum(['organico', 'anuncio']).optional().describe('"anuncio" si es para pauta en Meta (sale con prioridad, no se programa en redes). Por defecto "organico".'),
          rehacer: z.boolean().optional().describe('Solo si Diego pidió expresamente rehacer un video que ya se produjo'),
        }, async ({ titulo, guion, base, prioridad, tipo, rehacer }) => {
          let item;
          try { item = enqueueScript({ title: titulo, script: guion, base, prio: Boolean(prioridad), tipo: tipo || 'organico', rehacer: Boolean(rehacer) }); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
          return { content: [{ type: 'text', text: `En cola de producción (${item.id.slice(0, 8)})${item.prio ? ', con prioridad' : ''}.` }] };
        }),
      ] : []),
      ...(agent.studio ? [
        tool('encargar_render', 'Pone en la cola del servidor el render final 1080×1920 de un video del estudio (unos 20 min). El control de calidad y la entrega del video a Diego para aprobar son automáticos.',
          { carpeta: z.string().describe('Nombre de la carpeta en videos/, por ejemplo 25-mi-video'), titulo: z.string().describe('Título del video para Diego'),
            tipo: z.enum(['organico', 'anuncio']).optional().describe('"anuncio" si es un video para pauta en Meta (llega al Estudio marcado como anuncio y no se programa en redes)') },
          async ({ carpeta, titulo, tipo }) => {
            try {
              const job = startRender({ video: carpeta, scale: 1, name: 'Final', review: { agentId: agent.id, title: tipo === 'anuncio' && !/anuncio/i.test(titulo) ? `📣 Anuncio · ${titulo}` : titulo, taskId: ctx.taskId || null, ...(tipo === 'anuncio' ? { tipo: 'anuncio' } : {}) } });
              if (ctx.taskId) markAwaitingVideo(ctx.taskId);
              log(agent.id, `Encargó el render final de ${carpeta}`, 'start');
              return { content: [{ type: 'text', text: `Render en cola (trabajo ${job.id.slice(0, 8)}). Cuando termine, el video llega a la Bandeja de Diego con su control de calidad. No esperes: terminá tu turno con el resumen.` }] };
            } catch (e) {
              return { content: [{ type: 'text', text: `No se pudo encargar: ${e.message}` }], isError: true };
            }
          }),
      ] : []),
      ...(agent.coordinator || agent.ceo ? coordinatorTools(agent, ctx) : []),
      ...(agent.ceo ? ceoTools() : []),
      ...lecturaTools(),
      ...(agent.coordinator || agent.ceo || agent.dept === 'marketing' ? publicacionesTools() : []),
      ...(agent.coordinator || agent.ceo || agent.sales || agent.id === 'calidad_leads' ? conversacionTools() : []),
      ...(agent.coordinator || agent.sales || agent.id === 'media' ? anunciosTextoTools() : []),
      ...((agent.coordinator || agent.dept === 'marketing' || agent.id === 'media') && !agent.studio ? videoTools(agent) : []),
      ...(agent.coordinator || agent.pauta || agent.auditor || agent.id === 'gerente_ventas' ? [tool('embudo_por_anuncio', 'Embudo de ventas de WhatsApp agrupado por el anuncio del que vino cada contacto: leads, respondieron, vieron precio, pidieron demo, demos aceptadas y enviadas, no califican, con persona y cotizaciones. Es la verdad de negocio para juzgar un anuncio (el "resultado" de Meta no es una venta).', { dias: z.number().int().min(1).max(120).optional() },
        async ({ dias = 30 }) => ({ content: [{ type: 'text', text: JSON.stringify(ventas.embudoPorAnuncio(dias), null, 1) }] }))] : []),
      ...(agent.learns ? learningTools(agent) : []),
      ...(areasDe(agent).length ? [tool('guias', 'Guías expertas (en inglés) para tu trabajo: Meta Ads, creativos, copy, ofertas, CRO, ventas por WhatsApp. Sin archivo: te da el índice y las reglas para aplicarlas en Cresova (leelo primero). Con archivo ("area/nombre.md"): te da esa guía completa. Consultala cuando la tarea lo pida; no hace falta leer todo.', { archivo: z.string().optional().describe('Ej.: "meta-ads/adadvisor__diagnostic-tree.md". Vacío = índice.') },
        async ({ archivo }) => ({ content: [{ type: 'text', text: leerGuia(agent, archivo) }] }))] : []),
    ],
  });
}

// Filtro de la terminal de los agentes del estudio: el contenedor es el límite
// real, pero esto evita los descuidos más caros (llaves, red, borrar fuera del estudio).
const BASH_RULES = [
  [/\b(printenv|env)\b/, 'No se permite listar variables de entorno.'],
  [/API_KEY|OAUTH|TOKEN|SECRET|PASSWORD/i, 'No se permite tocar llaves, tokens ni contraseñas.'],
  [/state\.json|\.claude\b|\.\.\/(\.\.\/)*[^\s/]*[*?[]/, 'Solo podés trabajar dentro del estudio.'],
  [/\/proc\/|\/etc\/|\/root\b|~\/\.|\/home\//, 'Solo podés trabajar dentro del estudio.'],
  [/\b(curl|wget|nc|ncat|ssh|scp|rsync)\b/, 'Sin conexiones de red desde la terminal: usá los scripts del estudio.'],
  [/(^|[\s"'=])\/data\/(?!estudio\b|plugins\b)/, 'Solo podés trabajar dentro del estudio.'],
  [/\brm\s+(-\w*\s+)*(\/|~|\*|\.\.?(\s|$)|videos\/?(\s|$)|assets|src\b|scripts\b)/, 'Ese borrado está bloqueado.'],
  [/(>>?|\btee\s+(-a\s+)?)\s*["']?videos\/(0\d|1\d|2[0-4]|_plantilla)\b|\b(rm|mv)\b[^|;&]*videos\/(0\d|1\d|2[0-4]|_plantilla)\b|\bsed\s+-i[^|;&]*videos\/(0\d|1\d|2[0-4]|_plantilla)\b/,
    'No se modifican los videos existentes ni la plantilla: trabajá en tu carpeta nueva.'],
];

// Los videos ya publicados (01–24) y la plantilla son de solo lectura.
const PROTECTED = /(^|\/)videos\/(0\d|1\d|2[0-4]|_plantilla)[\w-]*\//;

async function fileGuard(input) {
  const file = String(input?.tool_input?.file_path ?? '');
  if (PROTECTED.test(file)) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Los videos existentes y la plantilla son de solo lectura: trabajá en tu carpeta nueva.' } };
  }
  return {};
}

// Los demás agentes solo escriben en su propia carpeta (pueden leer el estudio, no tocarlo).
// Ningún agente lee las llaves ni el estado interno de la oficina, por ninguna herramienta.
async function secretGuard(input) {
  // Los resultados largos de herramientas quedan en tool-results del SDK: esos sí se pueden leer.
  const raw = JSON.stringify(input?.tool_input ?? {}).replace(/[^"]*?[\\/]\.claude[\\/]projects[\\/](?:[\w-]+[\\/])+tool-results[\\/][\w-][\w.-]*(?=")/g, '');
  if (/secrets|state\.json|\.claude[\\/\\\\]|\/data\/?"|\/data\/(?!estudio\b|plugins\b)/i.test(raw)) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Esa ruta es privada de la oficina.' } };
  }
  return {};
}
const READS = { matcher: 'Read|Grep|Glob|LS', hooks: [secretGuard] };

const writeGuardFor = (cwd) => async (input) => {
  const f = path.resolve(cwd, String(input?.tool_input?.file_path ?? ''));
  if (f === cwd || f.startsWith(cwd + path.sep)) return {};
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Solo podés escribir archivos en tu propia carpeta de trabajo.' } };
};

async function bashGuard(input) {
  const cmd = String(input?.tool_input?.command ?? '');
  for (const [re, reason] of BASH_RULES) {
    if (re.test(cmd)) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  }
  return {};
}

function friendlyTool(name) {
  const [prefix, server, ...rest] = name.split('__');
  return prefix === 'mcp' && rest.length ? `${server} · ${rest.join('__')}` : name;
}

const STATUS_LABEL = { approved: 'aprobado', changes: 'cambios pedidos', pending: 'sin revisar' };

function buildContext(agent) {
  const peers = agent.inputs
    .map((id) => latestDeliverable(id))
    .filter(Boolean)
    .map((d) => `### Último entregable de ${getAgent(d.agentId).rol} (${new Date(d.ts).toLocaleDateString('es-HN')}, ${STATUS_LABEL[d.status]})\n\n${d.content}`)
    .join('\n\n');
  const lessons = feedbackFor(agent.id).slice(-8)
    .map((f) => `- "${f.title}" (${STATUS_LABEL[f.status]}): ${f.note || 'sin nota'}`)
    .join('\n');
  const pendientes = listDeliverables().filter((d) => d.agentId === agent.id && d.kind === 'decision' && d.status === 'pending' && !d.taskId)
    .map((d) => `- id ${d.id.slice(0, 8)} · ${new Date(d.ts).toLocaleDateString('es-HN')} · ${d.title}${d.question ? ` → "${d.question}"` : ''}`).join('\n');
  const vetos = (state.vetos || []).slice(-30).map((v) => `- ${v.tema}${v.motivo ? ` — motivo: ${v.motivo}` : ''}`).join('\n');
  const decisions = recentDecisions()
    .map((x) => `- ${new Date(x.ts).toLocaleDateString('es-HN')} · ${x.question} → **${x.answer}**${x.note ? ` (${x.note})` : ''}`)
    .join('\n');
  const reserve = agent.id === 'community' ? listDeliverables().filter((d) => d.kind === 'video' && d.status === 'approved' && !d.published && d.tipo !== 'anuncio' && !(!d.tipo && /anuncio/i.test(d.title || '')))
    .map((d) => `- ${d.title} · archivo renders-vps/${d.video.video}/${d.video.name} · guion videos/${d.video.video}/plan/script.md · id ${d.id.slice(0, 8)}`)
    .join('\n') : '';
  const L = state.linea;
  const lineaTxt = agent.coordinator && L ? `## Línea de producción de videos (la que produce sola, sin tablero)
- Encendida: ${L.enabled ? 'sí' : 'NO'} · hechos hoy ${L.produced?.[new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10)] || 0} de un máximo de ${L.maxPorDia} por día · reserva objetivo ${L.reserva} · editores en paralelo ${L.editores}
- En cola: ${(L.queue || []).filter((q) => q.status === 'queued').length} · produciendo: ${(L.queue || []).filter((q) => q.status === 'producing').map((q) => q.title).join(' | ') || 'nadie'}
- Lote de guiones en curso: ${L.batch ? L.batch.stage : 'ninguno'}
Si Diego pregunta por qué no se producen videos, revisá esto primero: si llegó al máximo del día, si está apagada o si falta cupo. El tablero es solo para trabajos sueltos.` : '';
  // Lo que ya está programado (tandas anteriores y oficina): para no repetir temas ni ganchos.
  const cal = ['guionista', 'viralidad', 'estratega', 'community'].includes(agent.id) ? (state.calendario?.titulos || []) : [];
  return [
    lineaTxt,
    cal.length && `## Videos ya programados en TikTok y YouTube (${cal.length}): no repitas sus temas, ganchos ni rubros cercanos\n${cal.map((t) => `- ${t}`).join('\n')}`,
    decisions && `## Decisiones recientes de Diego\nRespetalas en tu trabajo:\n${decisions}`,
    vetos && `## Temas que Diego CERRÓ (dijo que no: NO los vuelvas a proponer ni a preguntar, salvo que él lo saque de nuevo)\n${vetos}`,
    pendientes && `## Tus preguntas que Diego todavía no respondió\nNo le vuelvas a preguntar lo mismo. Si tu propuesta cambió, entregá la nueva con \`reemplaza\` = id de la vieja (la vieja sale de la Bandeja):\n${pendientes}`,
    agent.id === 'community' && `## Reserva: videos aprobados por Diego, sin publicar\n${reserve || 'Ninguno por ahora.'}`,
    peers && `## Contexto de tus compañeros\n\n${peers}`,
    lessons && `## Correcciones anteriores de Diego a tu trabajo\nAplicalas y no repitas esos errores:\n${lessons}`,
  ].filter(Boolean).join('\n\n');
}

function buildSystem(agent) {
  const manual = agent.dept === 'marketing' || agent.id === 'media' || agent.coordinator ? `\n\n---\n\n${getManual()}` : '';
  return `${getKnowledge()}${manual}

${getOfficeRules()}

---

${getRolePrompt(agent.id)}${memoriaBlock(agent)}${aprendizajesBlock(agent)}`;
}

const todayText = () => new Intl.DateTimeFormat('es-HN', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'short' }).format(new Date());

// Opciones comunes de trabajos y chats.
function buildOptions(agent, { abortController, delivered, system, extra = {}, ctx = {} }) {
  const studio = agent.studio === true;
  const cwd = studio ? ESTUDIO_DIR : path.join(DATA_DIR, 'workspace', agent.id);
  fs.mkdirSync(cwd, { recursive: true });
  const pluginDirs = (agent.plugins || []).map((n) => path.join(DATA_DIR, 'plugins', n)).filter((p) => fs.existsSync(p));
  const studioTools = studio ? {
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Skill', 'mcp__oficina__estado', 'mcp__oficina__entregar', 'mcp__oficina__encargar_render', 'mcp__oficina__recordar_indicacion', 'mcp__oficina__leer_entregable', 'mcp__oficina__buscar_entregables'],
    disallowedTools: ['NotebookEdit', 'WebSearch', 'WebFetch'],
    plugins: pluginDirs.map((p) => ({ type: 'local', path: p })),
    additionalDirectories: pluginDirs,
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [bashGuard] }, { matcher: 'Write|Edit', hooks: [fileGuard, secretGuard] }, READS] },
  } : {
    additionalDirectories: agent.readsStudio && fs.existsSync(ESTUDIO_DIR) ? [ESTUDIO_DIR] : [],
    hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [writeGuardFor(cwd), secretGuard] }, READS] },
  };
  const allMcp = loadMcpConfig();
  const mcpServers = { oficina: officeServer(agent, delivered, ctx) };
  for (const name of agent.mcp) if (allMcp[name]) mcpServers[name] = allMcp[name];
  const missing = agent.mcp.filter((n) => !allMcp[n]);

  const options = {
    model: agent.model || process.env.AGENT_MODEL || 'claude-sonnet-5-5',
    effort: agent.effort || process.env.AGENT_EFFORT || 'medium',
    systemPrompt: system,
    cwd,
    mcpServers,
    settingSources: [],
    allowedTools: [...BUILTIN_ALLOWED, 'mcp__oficina__leer_entregable', 'mcp__oficina__buscar_entregables', ...(agent.coordinator || agent.dept === 'marketing' ? ['mcp__oficina__publicaciones_programadas', 'mcp__oficina__organico_por_video'] : []), ...(agent.coordinator || agent.sales ? ['mcp__oficina__pedir_llamada', 'mcp__oficina__ver_conversacion', 'mcp__oficina__seguimientos_programados', 'mcp__oficina__chats_colgados'] : []), ...(agent.id === 'media' ? ['mcp__oficina__anuncios_por_aprobar', 'mcp__oficina__anuncio_aprobar'] : []), ...(agent.coordinator || agent.sales || agent.id === 'media' ? ['mcp__oficina__anuncio_videos', 'mcp__oficina__anuncio_video_enlace', 'mcp__oficina__anuncio_video_registrar', 'mcp__oficina__anuncio_texto_registrar', 'mcp__oficina__anuncio_texto_lista'] : []), 'mcp__oficina__estado', 'mcp__oficina__entregar', 'mcp__oficina__recordar_indicacion', ...(agent.coordinator || agent.id === 'media' || agent.id === 'gerente_ventas' ? ['mcp__oficina__embudo_por_anuncio'] : []), ...(agent.coordinator ? [...COORDINATOR_TOOLS, ...REMINDER_TOOLS, 'mcp__oficina__whatsapp_a_diego', 'mcp__oficina__discord_a_diego', 'mcp__oficina__ver_bandeja', 'mcp__oficina__recontacto_pausar', 'mcp__oficina__recontacto_reanudar', 'mcp__oficina__recontacto_estado', 'mcp__oficina__desarrollo_estado', 'mcp__oficina__desarrollo_pedir', 'mcp__oficina__proyectos_lista', 'mcp__oficina__proyecto_mover', 'mcp__oficina__replicar_video'] : []), ...(agent.coordinator || agent.dept === 'marketing' || agent.id === 'media' ? VIDEO_TOOLS : []), ...(agent.learns ? LEARNING_TOOLS : []), ...(areasDe(agent).length ? ['mcp__oficina__guias'] : []), ...(agent.id === 'viralidad' ? ['mcp__oficina__encolar_video'] : []), ...(agent.sales ? SALES_TOOLS : []), ...(agent.pauta || agent.auditor ? ['mcp__oficina__pauta_tablero', 'mcp__oficina__bitacora_leer', 'mcp__oficina__embudo_por_anuncio', ...(agent.id === 'media' ? ['mcp__oficina__bitacora_registrar', 'mcp__oficina__pedir_anuncio'] : []), ...(agent.id !== 'calidad_leads' && !agent.auditor ? ['mcp__oficina__bitacora_cerrar'] : []), ...(agent.id === 'calidad_leads' ? ['mcp__oficina__leads_sin_clasificar', 'mcp__oficina__clasificar_lead', 'mcp__oficina__ver_conversacion'] : [])] : []), ...(agent.prospeccion ? ['mcp__oficina__prospeccion_resultados', 'mcp__oficina__prospeccion_sondeo', 'mcp__oficina__prospeccion_proponer', 'mcp__oficina__negocio_prospeccion', 'mcp__oficina__negocio_clientes', 'mcp__oficina__negocio_analiticas'] : []), ...(agent.ceo ? [...COORDINATOR_TOOLS, ...CEO_TOOLS, 'mcp__oficina__ver_conversacion', 'mcp__oficina__pedir_llamada', 'mcp__oficina__seguimientos_programados', 'mcp__oficina__chats_colgados', 'mcp__oficina__publicaciones_programadas', 'mcp__oficina__organico_por_video', 'mcp__oficina__ventas_resumen', 'mcp__oficina__leer_playbook', 'mcp__oficina__recontacto_estado', 'mcp__oficina__desarrollo_estado', 'mcp__oficina__proyectos_lista'] : []), ...(conNegocio(agent) ? [...NEGOCIO_LECTURA, ...(agent.coordinator || agent.sales ? ['negocio_crear_pendiente'] : []), ...(agent.coordinator ? ['negocio_registrar_pago', 'negocio_registrar_gasto', 'negocio_crear_caso', 'negocio_cotizacion_pdf', 'negocio_propuesta_agente'] : [])].map((t) => `mcp__oficina__${t}`) : [])],
    disallowedTools: ['Bash', 'NotebookEdit', ...CRESOVA_MCP_VIEJO, ...UPLOADPOST_ESCRITURA],
    maxBudgetUsd: agent.maxBudgetUsd,
    abortController,
    ...studioTools,
    canUseTool: async (toolName, input, { signal }) => {
      if (!toolName.startsWith('mcp__')) {
        return { behavior: 'deny', message: 'Esa herramienta no está habilitada en la oficina.' };
      }
      if (!needsApproval(toolName)) return { behavior: 'allow', updatedInput: input };
      // Autonomía: lo que entra en los límites que fijó Diego pasa solo (por ejemplo, Renata dentro del presupuesto).
      const auto = await (await import('./autonomia.mjs')).autoAprobar(agent, toolName, input).catch(() => null);
      if (auto?.ok) { log(agent.id, `${friendlyTool(toolName)}: ${auto.nota}`, 'ok'); return { behavior: 'allow', updatedInput: input }; }

      setAgent(agent.id, { status: 'waiting', text: `Esperando aprobación: ${friendlyTool(toolName)}` });
      log(agent.id, `Pide aprobación para ${friendlyTool(toolName)}`, 'approval');
      const { decision, note } = await requestApproval(agent.id, toolName, input, signal);
      setAgent(agent.id, { status: 'working', text: decision === 'approved' ? 'Aprobado, ejecutando…' : 'Rechazado, sigo con lo demás' });
      log(agent.id, `Diego ${decision === 'approved' ? 'aprobó' : 'no aprobó'} ${friendlyTool(toolName)}${note ? `: ${note}` : ''}`, decision === 'approved' ? 'ok' : 'warn');
      return decision === 'approved'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: `Diego no aprobó esta acción.${note ? ` Nota: ${note}` : ''}` };
    },
    ...extra,
  };
  return { options, missing };
}

// Traduce los mensajes del SDK a estado visible. Devuelve el resultado final.
async function consume(agentId, q) {
  let result = null;
  let sessionId = null;
  for await (const msg of q) {
    if (msg.session_id) sessionId = msg.session_id;
    if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_use' && !block.name.startsWith('mcp__oficina__')) {
          setAgent(agentId, { status: 'tool', text: friendlyTool(block.name), tool: block.name });
        } else if (block.type === 'text' && block.text.trim()) {
          setAgent(agentId, { status: 'working', text: block.text.trim().slice(0, 140) });
        }
      }
    } else if (msg.type === 'rate_limit_event') {
      noteRateLimit(msg.rate_limit_info);
    } else if (msg.type === 'result') {
      result = msg;
      // Uso real del plan (ventana de 5 h y semana); la API es experimental, si falla se ignora.
      try {
        const u = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.({ skipBehaviors: true });
        u?.then((x) => noteUsage(x?.rate_limits)).catch(() => {});
      } catch {}
      if (typeof msg.total_cost_usd === 'number') { addCost(agentId, msg.total_cost_usd); noteSpend(agentId, msg.total_cost_usd); }
      if (msg.subtype !== 'success') log(agentId, `Terminó con error: ${msg.subtype}`, 'error');
    }
  }
  return { result, sessionId };
}

export async function runAgent(agentId, { reason = 'manual', instruction, taskId, noRetry = false } = {}) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agente desconocido: ${agentId}`);
  if (running.has(agentId)) return false;
  // Sin cupo de Claude: el encargo espera al reinicio (las tareas del tablero esperan en su columna).
  if (isBlocked()) {
    if (!taskId && !noRetry) queueRetry({ agentId, instruction, reason });
    return 'limited';
  }

  const abortController = new AbortController();
  running.set(agentId, abortController);
  const delivered = [];
  let limited = false;
  const { options, missing } = buildOptions(agent, { abortController, delivered, system: buildSystem(agent), extra: { maxTurns: agent.studio ? 300 : 60 }, ctx: { taskId, reason } });

  setAgent(agentId, { status: 'working', text: 'Llegando al escritorio…', lastRun: Date.now() });
  log(agentId, `Empieza su turno (${reason})${missing.length ? ` · sin conexión a: ${missing.join(', ')}` : ''}`, 'start');

  const context = buildContext(agent);
  const task = instruction ? `## Encargo\n${instruction}\n\nHacé este encargo` : 'Hacé tu trabajo de hoy';
  const prompt = `Hoy es ${todayText()}.\n\n${context ? `${context}\n\n` : ''}${task} y terminá con \`mcp__oficina__entregar\`.`;

  try {
    const { result } = await consume(agentId, query({ prompt, options }));
    if (result && result.subtype !== 'success' && isLimitError(JSON.stringify(result))) throw new Error(String(result.result || 'Límite de uso'));
    if (!delivered.length) log(agentId, 'Terminó sin entregar nada', 'warn');
    setAgent(agentId, { status: 'idle', text: delivered.length ? `Entregó: ${delivered.at(-1).title}` : 'Disponible', tool: null });
  } catch (err) {
    const aborted = abortController.signal.aborted;
    if (!aborted && isLimitError(err.message)) {
      limited = true;
      onLimitHit(taskId || noRetry ? null : { agentId, instruction, reason, cut: true });
      log(agentId, 'Lo cortó el límite de uso de Claude: retoma solo cuando vuelva el cupo', 'warn');
      setAgent(agentId, { status: 'idle', text: 'Esperando que vuelva el cupo de Claude', tool: null });
      return 'limited';
    }
    log(agentId, aborted ? 'Corrida cancelada' : `Error: ${err.message}`, aborted ? 'warn' : 'error');
    setAgent(agentId, { status: aborted ? 'idle' : 'error', text: aborted ? 'Disponible' : err.message.slice(0, 140), tool: null });
    return aborted ? 'aborted' : 'error';
  } finally {
    running.delete(agentId);
  }
  return true;
}

const CHAT_RULES = `

## Conversación directa
Estás hablando con Diego en el chat de la oficina. Respondé corto y claro, sin rodeos, en español. Escribí para que se lea fácil: párrafos cortos separados por una línea en blanco y listas cuando enumeres. Si te pide un trabajo grande, hacelo y entregalo con \`mcp__oficina__entregar\` (después contale en una frase qué entregaste). Si no tenés un dato, decilo. Si Diego da una indicación que debe valer para siempre (cómo decir algo, qué evitar, una preferencia, un dato del negocio), guardala con \`mcp__oficina__recordar_indicacion\`, eligiendo a quién aplica (todos, marketing, ventas o un agente; el vendedor de WhatsApp es \`vendedor\`), y confirmale en una línea que quedó guardada. No la guardes si es algo de una sola vez.`;

export async function chatAgent(agentId, text, { canal = 'oficina' } = {}) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agente desconocido: ${agentId}`);
  if (running.has(agentId)) return false;

  const abortController = new AbortController();
  running.set(agentId, abortController);
  const delivered = [];
  const chat = chatOf(agentId);
  const { options } = buildOptions(agent, {
    abortController, delivered, system: buildSystem(agent) + CHAT_RULES,
    extra: { maxTurns: 30, ...(chat.sessionId ? { resume: chat.sessionId } : {}) }, ctx: { conDiego: true },
  });

  addChatMessage(agentId, 'user', canal === 'whatsapp' ? `📱 ${text}` : canal === 'voz' ? `🎙️ ${text}` : text);
  setAgent(agentId, { status: 'working', text: canal === 'whatsapp' ? 'Leyendo tu WhatsApp…' : 'Leyendo tu mensaje…', lastRun: Date.now() });
  log(agentId, 'Conversa con Diego', 'start');

  // En la primera vuelta de una sesión nueva se le da el contexto de la semana.
  const context = chat.sessionId ? '' : buildContext(agent);
  const viaWa = canal === 'whatsapp' ? '[Diego te escribe por WhatsApp: respondé corto, en formato de WhatsApp, máximo 6–8 líneas]\n' : canal === 'voz' ? '[Diego te habla por VOZ (Discord). Sos el mismo Jarvis que le habla: tu respuesta la dice tu propia voz, en primera persona ("le pedí a Luis", nunca "Jarvis dice"). Tu respuesta se lee en voz alta. Máximo 3 oraciones cortas, en texto plano: sin listas, sin símbolos, sin enlaces ni formato, montos dichos con palabras. Si es un trabajo largo, contá en una frase qué vas a hacer y dejalo en curso.]\n' : '';
  // Jarvis es uno solo: lo que Diego habló con él por voz (y todavía no vio acá) entra como memoria propia.
  let memVoz = '';
  if (agentId === 'coordinador') { try { const v = (await import('./voz.mjs')).vozSinVer(); if (v) memVoz = `[Lo que hablaste con Diego por voz (Discord) desde tu último mensaje; lo dijiste vos, es tu propia conversación:\n${v}]\n\n`; } catch {} }
  const prompt = chat.sessionId ? `${memVoz}${viaWa}${text}` : `Hoy es ${todayText()}.\n\n${context ? `${context}\n\n` : ''}${memVoz}${viaWa}Mensaje de Diego:\n${text}`;

  try {
    const { result, sessionId } = await consume(agentId, query({ prompt, options }));
    if (sessionId) setChatSession(agentId, sessionId);
    const reply = result?.subtype === 'success' && result.result?.trim()
      ? result.result.trim()
      : 'No pude responder esta vez. Probá de nuevo.';
    addChatMessage(agentId, 'agent', reply);
    setAgent(agentId, { status: 'idle', text: delivered.length ? `Entregó: ${delivered.at(-1).title}` : 'Disponible', tool: null });
    return reply;
  } catch (err) {
    const aborted = abortController.signal.aborted;
    addChatMessage(agentId, 'agent', aborted ? 'Me detuviste antes de terminar.' : `Tuve un error: ${err.message.slice(0, 200)}`);
    if (!aborted && isLimitError(err.message)) return 'Se me acabó el cupo de Claude por ahora; retomo apenas vuelva.';
    log(agentId, aborted ? 'Conversación cancelada' : `Error: ${err.message}`, aborted ? 'warn' : 'error');
    setAgent(agentId, { status: aborted ? 'idle' : 'error', text: aborted ? 'Disponible' : err.message.slice(0, 140), tool: null });
  } finally {
    running.delete(agentId);
  }
  return true;
}

const groupRules = (agent, dept) => `

## Chat grupal de ${dept}
Estás en el chat grupal del departamento de ${dept} con Diego y el resto del equipo. Respondé como ${agent.nombre}, en pocas líneas y al grano, en español. Si Diego le habla a una persona en particular, responde solo esa persona. Mencioná a un compañero con @Nombre únicamente si de verdad necesitás que él conteste algo concreto ahora (no para saludar ni para avisar). No repitas lo que otro ya dijo. Escribí para que se lea fácil en el chat: párrafos cortos separados por una línea en blanco, listas cuando enumeres, y nada de bloques largos. Un trabajo grande no se hace en el chat: va al tablero como tarea${agent.coordinator ? ' (vos la creás con `mcp__oficina__crear_tarea`, después de confirmarlo con Diego si es costoso)' : ' (lo crea el coordinador)'}. Si Diego da una indicación que debe valer para siempre (cómo decir algo, qué evitar, una preferencia, un dato del negocio), guardala con \`mcp__oficina__recordar_indicacion\`, eligiendo a quién aplica (todos, marketing, ventas o un agente; el vendedor de WhatsApp es \`vendedor\`), y confirmale en una línea que quedó guardada. No la guardes si es algo de una sola vez.`;

// Respuesta de un agente en el chat grupal: sin sesión propia, lee la conversación reciente.
export async function groupReply(agentId, dept, { encargo, maxTurns } = {}) {
  const deptName = DEPARTMENTS.find((d) => d.id === dept)?.nombre || dept;
  const agent = getAgent(agentId);
  if (!agent || running.has(agentId)) return null;
  const abortController = new AbortController();
  running.set(agentId, abortController);
  const delivered = [];
  const { options } = buildOptions(agent, {
    abortController, delivered, system: buildSystem(agent) + groupRules(agent, deptName),
    extra: { maxTurns: maxTurns || (agent.coordinator ? 20 : 10) }, ctx: { conDiego: !encargo },
  });
  setAgent(agentId, { status: 'working', text: encargo ? 'En la reunión semanal…' : 'Leyendo el chat del equipo…', lastRun: Date.now() });
  const prompt = `Hoy es ${todayText()}.\n\nConversación reciente del chat de ${deptName}:\n\n${transcript(dept, 16)}\n\n${encargo ? `ESTÁS EN LA REUNIÓN SEMANAL. Tu parte: ${encargo}\nUsá tus herramientas para traer los números reales. Escribí para el chat (corto, directo, con números y su fuente; nada de saludos). Si Diego escribió algo en el chat, respondele primero.\n\n` : ''}Respondé ahora como ${agent.nombre}.`;
  try {
    const { result } = await consume(agentId, query({ prompt, options }));
    return result?.subtype === 'success' ? result.result?.trim() || null : null;
  } catch (err) {
    log(agentId, `Error en el chat grupal: ${err.message}`, 'error');
    return null;
  } finally {
    running.delete(agentId);
    setAgent(agentId, { status: 'idle', text: 'Disponible', tool: null });
  }
}

export function stopAgent(agentId) {
  running.get(agentId)?.abort();
}

// ---------- medidor de cupo ----------
// Una consulta mínima (Haiku, sin herramientas) cuyo único fin es recibir el aviso de cupo
// del plan: así el medidor está al día aunque nadie esté trabajando. Cuesta casi nada.
export async function medirCupo() {
  // 1) Directo: los encabezados de la API traen el uso del plan (5 h y 7 días), igual que en Claude Code.
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (token) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1, system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }], messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(30_000),
      });
      const h = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('anthropic-ratelimit-unified')));
      const { noteHeaders } = await import('./cupo.mjs');
      if (noteHeaders(h, res.status)) return true;
    } catch {}
  }
  // 2) Respaldo: una consulta mínima por el SDK para recibir su aviso de cupo.
  const q = query({ prompt: 'Respondé solo: ok', options: { model: 'claude-haiku-5-5', maxTurns: 1, allowedTools: [], settingSources: [], cwd: DATA_DIR, systemPrompt: 'Respondé solo: ok' } });
  let visto = false;
  for await (const msg of q) {
    if (msg.type === 'rate_limit_event') { noteRateLimit(msg.rate_limit_info); visto = true; }
    if (msg.type === 'result') {
      try { noteUsage((await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.({ skipBehaviors: true }))?.rate_limits); } catch {}
      if (typeof msg.total_cost_usd === 'number') noteSpend('medidor', msg.total_cost_usd);
    }
  }
  return visto;
}
