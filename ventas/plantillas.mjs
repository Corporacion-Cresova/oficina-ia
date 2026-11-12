// Plantillas de WhatsApp (API oficial): pasadas 24 horas desde el último mensaje del cliente, WhatsApp solo deja
// escribirle con plantillas aprobadas por Meta. Aquí están las de Cresova, cómo se mandan a aprobar y cuál usar
// según el tipo de envío. Todas llevan botones de respuesta rápida: si el cliente toca uno, se abre otra ventana de
// 24 h y el vendedor sigue la conversación normal.
export const PLANTILLAS = [
  { name: 'cresova_demo_lista', category: 'MARKETING', params: ['nombre', 'enlace'], ejemplo: ['Ana', 'https://demo.preview.cresova.com/pasteleria-ana/'],
    body: 'Hola {{1}}, ya está lista la propuesta de tu página web: {{2}}\n\nÁbrela desde tu celular y cuéntame qué te parece. Podemos ajustar fotos, textos y servicios.', botones: ['Me gusta', 'Quiero cambios'] },
  { name: 'cresova_seguimiento_1', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, ¿pudiste ver lo que te compartimos sobre tu página web? Si quieres, te armamos una demo sin costo para que veas cómo quedaría.', botones: ['Sí, quiero verla', 'Más adelante'] },
  { name: 'cresova_seguimiento_2', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, una página bien hecha hace que te encuentren en Google y que los clientes te escriban por WhatsApp listos para comprar. ¿Te armamos la demo esta semana?', botones: ['Sí, armémosla', 'Ahora no'] },
  { name: 'cresova_demo_vista', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, ¿pudiste ver la demo de tu página? Cuéntame qué te pareció y si quieres que ajustemos algo.', botones: ['Me gustó', 'Quiero cambios'] },
  { name: 'cresova_demo_ajustes', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, ¿quieres que ajustemos algo de tu demo antes de arrancar? El pago es 50 % al empezar y 50 % al entregar la página.', botones: ['Arranquemos', 'Tengo dudas'] },
  { name: 'cresova_cierre', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, no quiero insistir. ¿Lo dejamos para más adelante o avanzamos esta semana con tu página web?', botones: ['Avancemos', 'Más adelante'] },
  { name: 'cresova_ultimo_contacto', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, ¿sigues con la idea de tener tu página web? Cuando quieras, aquí estamos para ayudarte.', botones: ['Sí, me interesa', 'Ya no, gracias'] },
  { name: 'cresova_recontacto', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, hace un tiempo hablamos de tu página web con Cresova. ¿Sigues interesado? Te podemos mostrar una propuesta sin costo.', botones: ['Sí, muéstrame', 'No, gracias'] },
  { name: 'cresova_pago_pendiente', category: 'UTILITY', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, te escribimos por el anticipo de tu página web con Cresova. ¿Te comparto de nuevo los datos para el pago?', botones: ['Sí, por favor', 'Ya pagué'] },
  // Posventa (reseña + referido). BORRADOR: no se manda a Meta hasta que Diego apruebe el texto (borrador: true).
  { name: 'cresova_resena', category: 'MARKETING', borrador: true, params: ['nombre', 'enlace'], ejemplo: ['Ana', 'https://g.page/r/ejemplo/review'],
    body: 'Hola {{1}}, gracias por confiar en Cresova para tu página web. ¿Nos regalas 1 minuto para dejarnos tu opinión en Google? {{2}} Y si conoces a alguien que necesite su página, con gusto lo atendemos.', botones: ['Ya la dejé', 'Recomendar a alguien'] },
  // Secuencia nueva de Martín (aprobada por Diego el 9 nov). Si Meta no las aprobó todavía, siguen saliendo las anteriores.
  { name: 'cresova_demo_ajuste', category: 'MARKETING', params: ['nombre', 'negocio'], ejemplo: ['Ana', 'Pastelería Ana'],
    body: 'Hola {{1}}, ¿ya viste la demo de {{2}}? Le podemos poner tus fotos y textos antes de que decidas nada.', botones: ['Ajustarla', 'Dejarla así'] },
  { name: 'cresova_demo_decision', category: 'MARKETING', params: ['nombre', 'negocio'], ejemplo: ['Ana', 'Pastelería Ana'],
    body: 'Hola {{1}}, con la demo de {{2}} quedan dos caminos: la ajustamos o arrancamos con la mitad del pago y la otra al publicarla. ¿Qué prefieres?', botones: ['Ajustarla', 'Arrancar', 'Llamada de 10 min'] },
  { name: 'cresova_demo_cierre', category: 'MARKETING', params: ['nombre', 'negocio'], ejemplo: ['Ana', 'Pastelería Ana'],
    body: 'Hola {{1}}, no te quiero llenar el chat. ¿Te dejo guardada la demo de {{2}} para retomarla cuando quieras?', botones: ['Guárdala', 'Retomarla ya', 'No, gracias'] },
  { name: 'cresova_lead_retomar', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, soy Diego de Cresova. Quedó pendiente la demo gratis de tu página: la armamos en 24 a 48 h y la ves antes de pagar. ¿Te la armo?', botones: ['Sí, ármala', 'Más adelante'] },
  { name: 'cresova_lead_cierre', category: 'MARKETING', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, no te escribo más por esto. ¿Te armamos la demo o te escribo más adelante?', botones: ['Ármala', 'Más adelante', 'No me interesa'] },
  // Seguimiento de lo que el cliente dijo que iba a hacer (Fase 2 de compromisos, 11 nov). {{2}} = "mostrarle la demo a tus ingenieros".
  { name: 'cresova_compromiso', category: 'MARKETING', params: ['nombre', 'pendiente'], ejemplo: ['Ana', 'mostrarle la demo a tu socio'],
    body: 'Hola {{1}}, te escribo por lo que quedamos: {{2}}. ¿Cómo te fue con eso?', botones: ['Te cuento', 'Todavía no', 'Llámenme'] },
  // Cobranza del 50 % final, cuando la página ya se entregó (Diego aprobó mandarla a Meta el 6 nov).
  { name: 'cresova_saldo_pendiente', category: 'UTILITY', params: ['nombre'], ejemplo: ['Ana'],
    body: 'Hola {{1}}, tu página web con Cresova ya está lista. Te escribimos por el saldo pendiente. ¿Te comparto los datos para el pago?', botones: ['Sí, por favor', 'Ya pagué'] },
];

// Qué plantilla corresponde a cada tipo de envío automático (meta del mensaje). Sin plantilla → "llamar".
// Cómo saludar: el nombre de pila si lo hay (sin títulos como Abog./Lic./Ing.), nunca palabras de cuenta de empresa
// ("Gerencia", "Ventas", "Info"…); si no, el nombre del negocio completo; si tampoco, "qué tal".
const NO_NOMBRE = /^(gerencia|gerente|ventas|venta|info|informacion|información|admin|administracion|administración|oficina|recepcion|recepción|contabilidad|soporte|servicio|servicios|tienda|empresa|clientes|atencion|atención|negocio|cresova|hola|whatsapp|business|ceo|director|directora|asistente)$/i;
const TITULO = /^(abog|abg|lic|licda|ing|inga|dr|dra|arq|prof|profa|sr|sra|srta|don|doña)$/i;
export function nombreSaludo(conv) {
  const palabras = String(conv.contacto?.nombre || '').replace(/[~*_]/g, ' ').split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  while (palabras.length && TITULO.test(palabras[0])) palabras.shift();
  if (palabras[0] && palabras[0].length > 1 && !NO_NOMBRE.test(palabras[0])) return palabras[0][0].toUpperCase() + palabras[0].slice(1).toLowerCase();
  const empresa = String(conv.contacto?.empresa || '').trim();
  return empresa ? empresa.slice(0, 40) : 'qué tal';
}

export function plantillaPara(conv, meta = {}) {
  const nombre = nombreSaludo(conv);
  if (meta.demo) return { name: 'cresova_demo_lista', params: [nombre, meta.demo] };
  if (meta.seguimiento) return { name: ['cresova_seguimiento_1', 'cresova_seguimiento_2', 'cresova_cierre', 'cresova_ultimo_contacto'][Math.min(3, meta.seguimiento - 1)], params: [nombre] };
  if (meta.plantillaDemo) return { name: meta.plantillaDemo, params: PLANTILLAS.find((p) => p.name === meta.plantillaDemo)?.params.includes('negocio') ? [nombre, String(conv.contacto?.empresa || 'tu negocio').slice(0, 60)] : [nombre] };
  if (meta.seguimientoDemo) return { name: ['cresova_demo_vista', 'cresova_demo_ajustes', 'cresova_cierre'][Math.min(2, meta.seguimientoDemo - 1)], params: [nombre] };
  if (meta.recontacto) return { name: 'cresova_recontacto', params: [nombre] };
  if (meta.cuenta || meta.imagenCuenta || meta.anticipo) return { name: 'cresova_pago_pendiente', params: [nombre] };
  // Seguimiento de un compromiso del cliente (Fase 2). La propia si Meta ya la aprobó; si no, la más parecida por tipo.
  if (meta.compromiso) {
    const k = meta.compromiso;
    const negocio = String(conv.contacto?.empresa || 'tu negocio').slice(0, 60);
    const respaldo = k.tipo === 'pago' ? { name: /saldo/i.test(k.recordatorio || '') ? 'cresova_saldo_pendiente' : 'cresova_pago_pendiente', params: [nombre] }
      : k.demo && ['consulta', 'reunion', 'otro'].includes(k.tipo) ? { name: 'cresova_demo_decision', params: [nombre, negocio] }
        : k.demo && k.tipo === 'material' ? { name: 'cresova_demo_ajuste', params: [nombre, negocio] }
          : k.demo ? { name: 'cresova_demo_vista', params: [nombre] }
            // Sin plantilla que hable de lo mismo no sale nada (va a Llamadas). Antes salía "¿sigues con la idea de tu
            // página web?", que no tiene que ver con lo que dijo (11 nov: FK, cliente pagado, por unos correos).
            : null;
    return k.recordatorio ? { name: 'cresova_compromiso', params: [nombre, k.recordatorio], respaldo } : respaldo;
  }
  return null;
}
export const textoDe = (name, params) => (PLANTILLAS.find((p) => p.name === name)?.body || '').replace(/\{\{(\d)\}\}/g, (_, i) => params[Number(i) - 1] ?? '');
