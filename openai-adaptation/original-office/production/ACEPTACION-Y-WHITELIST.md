# Aceptación productiva y selección de componentes
15 noviembre 2026. Propuesta basada en lectura de código, no informe de pruebas ejecutadas.

## Candidatos: no confundir inspección con prueba
| Archivo original | Dependencias y riesgos | Selección propuesta |
|---|---|---|
| videos/_plantilla/src/amano.js | Canvas, sin import/red; colores por opciones, default Cresova | flecha, palomita, subrayado; sobre captura real explican acciones. circulo usa trazo irregular: cambiar por círculo limpio si lo exige Jorge. |
| objetos.js | three, DOM canvas para textura con semilla; crea geometrías/materiales, muta escena | campana, calendario, sobre, relojArena; parámetros de paleta obligatorios. Instanciar una vez, no por frame. |
| objetos2.js | three, RoundedBoxGeometry, phys/metal de objetos.js; fuentes y textos incrustados | burbujaComentario y cuaderno para flujo conversación→seguimiento; eliminar identidad/textos/fuentes no disponibles. tablaLista debe parametrizar título fijo ANTES DE PAGAR. |
| nucleo.js | three; update(t), mallas y partículas; identidad Cresova expresa | NO default multimarcas: solo ejemplo técnico o variante original diseñada para cada marca. |
| estudio3d.js/render.js | revisar compositor, WebGL/Chromium/FFmpeg y límites | candidato a motor real, previa prueba aislada; no etiquetar listo por copiar archivos. |

No se observó LICENSE en raíz de la copia inspeccionada. Permiso usuario/Diego para adaptar el proyecto privado no constituye licencia abierta de todos sus assets. Whitelist técnica no aprueba automáticamente voz, logo, audio, fuentes o material de terceros. Registrar fuente/hash/autor/alcance. No copiar skill protegida al fork. Los MP3/WAV, marca sonora y logo Cresova quedan excluidos del paquete predeterminado. Los dibujos generados por geometría siguen requiriendo atribución/procedencia del código cuando corresponda.

## Matriz de pruebas reales por etapa
A. Contexto: dos briefs (Glowfy/Velforce) con fuentes distintas, logos reales y una propiedad ausente deliberada. Éxito: datos separados, ausencia marcada, ninguna promesa fabricada. Evidencia: JSON, hashes y referencias recuperadas. No necesita inferencia para validar aislamiento.
B. Especialistas: ejecutar estrategia, guion, revisor y arte con Codex ya autorizado/conectado. Cada etapa recibe contrato autocontenido y produce artefacto propio. Éxito: no respuestas precargadas ni fixture; logs de invocación con uso/fecha y sin credenciales. Hasta esa ejecución se etiqueta configurado/mock probado.
C. Narrativa: revisión sin conocer guion y sin sonido de primeros 2s; entender destinataria y tensión. La solución debe corresponder a función real, CTA único. Registrar observador/modelo y lo que pudo observar; no inventar “escuché”. Cambios por defecto hasta corregir afirmaciones sin sustento.
D. Arte: tres cuadros clave 1080 y reducción móvil, recursos originales/internos legales. Objeto, jerarquía, transformación y transición diseñados para la idea; no reutilizar logo ni texto Cresova. Éxito: ninguna colisión, identidad consistente, texto legible; inspección humana/visual declarada.
E. Motion: renderizar 2s inicio/medio/final a 0.5; repetir mismo t y orden inverso para detectar dependencia de frames. Capturas comparables, comprobar heap/recursos no crecen por cada frame. Medir fps real; <1fps dispara simplificación, no aumento ciego recursos. Dejar reproducible entorno/versión/semilla.
F. Voz: primero pista grabada autorizada si existe; generación ElevenLabs solo con permiso/techo. Confirmar voiceId, texto, duración real/alineación, pronunciación. Si falta, avanzar en animática rotulada, no final narrado. Música no obligatoria ni licencia heredada.
G. Mezcla/render: 1080x1920,30fps como objetivo del brief; H264/yuv420p/AAC si hay audio, faststart; ffprobe y decodificación completa, escaneo negros y revisión de alertas. Verificar LUFS/pico solo si se midieron; no sustituye escucha/reproducción completa. Guardar tiempos de render y pico memoria reales.
H. Recuperación: reiniciar worker durante render y reintentar; conservar versión buena anterior, no duplicar costos externos. Controlar cancelación, error legible y reanudar solo frames válidos. Sin persistencia validada, no prometer supervivencia a redeploy.
I. Revisión: descarga del mismo MP4/hash que QA, aprobación exacta, revisión posterior invalida aprobación; artefactos por marca no cruzables. No intentar publicación automática en estas pruebas.
J. Autonomía: un brief nuevo llega hasta MP4 revisable sin edición manual oculta de archivos de guion/escena. Persona puede aprobar, proporcionar recursos o resolver permiso; documentar esa intervención. Dos marcas consecutivas con resultados reales, no solo JSON validado. Si falta algún paso, comunicar tramo autónomo exacto, no “todo listo”.

## Comparación justa Remotion vs motor Diego
Mismo brief, guion, voz, recursos autorizados, resolución/duración, especialistas y límite de recursos; única variable motor. Cambiar diseño por motor puede admitirse solo documentado. Orden de evaluación ciego por A/B. Medir: claridad hook, comprensión solución, legibilidad móvil, calidad movimiento/profundidad, sincronía/audio, distintividad de marca y errores; registrar también tiempo real, correcciones e intervenciones. Puntuaciones cualitativas con notas/timestamps, no probabilidad de ventas/viralidad. No comparar smoke técnico silencioso contra anuncio comercial con voz. Revisar tres piezas distintas antes de declarar preferencia general; primera pareja solo conclusión local.

## Límites de finalización
“Oficina visible” != “especialistas conectados” != “render real” != “autonomía probada” != “video comercial aprobado”. Bloqueos de auth, licencias o conectores deben quedar por fase; completar fases independientes. Inferencia por suscripción sin API pagada; ninguna caída a OpenRouter/Gemini/Anthropic por conveniencia. Sin conexiones sociales todavía se puede terminar/revisar/descargar un video. No afirmar persistencia, QA audio ni render completo sin comprobación correspondiente. Sin modificación del VPS en este trabajo.
