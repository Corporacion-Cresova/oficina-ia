// Punto de partida de una propuesta de Agente de IA. Todo es editable por cotización; los precios siempre los pone Diego.
export const PLANTILLA_AGENTE = {
  datos: {
    project_title: 'Agente de IA para atención y ventas',
    architecture: [
      { name: 'Canal de atención', description: 'El agente atiende a sus clientes por WhatsApp, con el número que se defina en el diagnóstico.' },
      { name: 'Base de conocimiento', description: 'Servicios, precios, horarios y preguntas frecuentes del negocio, que el agente usa para responder.' },
      { name: 'Reglas de conversación', description: 'Tono, límites y qué hacer en cada situación, para que responda como parte de su equipo.' },
      { name: 'Paso a una persona', description: 'Cuando el caso lo requiere, el agente avisa y su equipo continúa la conversación.' },
      { name: 'Seguimiento y reportes', description: 'Registro de conversaciones y resumen de resultados para medir y mejorar.' },
    ],
    phases: [
      { name: 'Diagnóstico y diseño', duration: 'Semana 1', deliverables: ['Levantamiento de procesos y preguntas frecuentes', 'Definición de qué resuelve el agente y qué pasa a una persona', 'Guion y reglas de conversación aprobados'] },
      { name: 'Construcción', duration: 'Semana 2', deliverables: ['Base de conocimiento cargada', 'Agente conectado al canal definido', 'Pruebas internas'] },
      { name: 'Piloto', duration: 'Semana 3', deliverables: ['Prueba con conversaciones reales', 'Corrección de respuestas', 'Capacitación de su equipo'] },
      { name: 'Lanzamiento', duration: 'Semana 4', deliverables: ['Agente en operación', 'Primer reporte de resultados', 'Inicio de la mensualidad'] },
    ],
    cond_tiempo: 'El tiempo de cada fase se confirma al terminar el diagnóstico y depende de la entrega oportuna de la información por parte del cliente.',
    cond_mes: 'Incluye operación y monitoreo del agente, actualización de su información y ajustes menores. Hasta [cantidad] conversaciones al mes; el excedente se cotiza por separado.',
    cond_terceros: 'Los costos de WhatsApp Business (Meta) y de otros servicios externos que el proyecto requiera no están incluidos y se pagan según su consumo.',
    cond_piloto: 'Incluye un periodo de piloto para corregir respuestas antes del lanzamiento. Funciones nuevas o cambios de alcance se cotizan por separado.',
    cond_datos: 'La información de sus clientes se usa únicamente para operar el agente y no se comparte con terceros ajenos al servicio.',
    cond_propiedad: 'Las conversaciones, los datos y el conocimiento de su negocio son propiedad del cliente. La plataforma y las herramientas con las que opera el agente son de Cresova y se utilizan mientras el servicio esté activo.',
    cond_limites: 'El agente responde con base en la información entregada y puede equivocarse. Los casos sensibles o fuera de su alcance pasan a una persona de su equipo.',
  },
  conceptos: [
    { name: 'Implementación del Agente de IA', description: 'Diagnóstico y diseño de la conversación\nConfiguración y base de conocimiento\nConexión al canal de atención\nPiloto y capacitación del equipo', unit_price: 0, quantity: 1, billing: 'one_time' },
    { name: 'Operación mensual del agente', description: 'Operación y monitoreo\nActualización de información\nAjustes menores\nReporte mensual de resultados', unit_price: 0, quantity: 1, billing: 'monthly' },
  ],
};
