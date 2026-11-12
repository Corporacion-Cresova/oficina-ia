# Aprendizajes del bot de Cresova en Velforce (documento de Lovable, 30/10/2026)

## Mensajes propios y pausa por humano
- Evolution devuelve también los mensajes que manda el bot (fromMe). Se guarda el id de cada envío y, si llega un fromMe con ese id, es eco del bot: se descarta. Si no existe, lo escribió una persona desde el teléfono → se pausa el bot en esa conversación (indefinido, se reactiva a mano).
- Si el id no se guarda antes de que llegue el eco, el bot se toma a sí mismo por humano y se pausa solo.
- Excepción: un fromMe antes de que el cliente escriba es el saludo automático de WhatsApp Business: no pausa.
- Antes de mandar cada parte de una respuesta se revisa si una persona tomó el chat; si sí, se corta.

## Recepción
- Se descartan grupos (@g.us), estados (status@broadcast) y canales (@newsletter).
- @lid: se resuelve con remoteJidAlt; si no, mapa aprendido o búsqueda en Evolution; si nada, contacto provisional.
- No deducir país ni idioma de un LID ni del prefijo (+351 no significa portugués si escribe en español).
- Duplicados: deduplicar por key.id.
- Anuncio de origen: contextInfo.externalAdReply; se guarda solo el primer toque.

## Buffer
- 13 s (Diego). Cada mensaje nuevo extiende la espera; se responde una sola vez con todo junto. Antes de llamar al modelo se revisa que el bot siga activo en esa conversación.

## Contexto
- Historial: primeros 20 + últimos 40 (máximo 60). Antes se mandaban solo los primeros 20 y el bot volvía a preguntar lo que el cliente ya había dicho.
- Se incluyen los mensajes de personas del equipo.
- Multimedia sin texto se describe en una línea ("[El cliente envió una imagen]") y también dispara la respuesta. Antes, con varias imágenes sin texto, el bot nunca respondía.
- El primer mensaje retoma la promesa del anuncio; un enlace o @ del cliente es información de su negocio.

## Envío
- División natural: partes de hasta 600 caracteres, 2 partes (3 si pasa de 1200). El primer mensaje no se divide.
- "Escribiendo…": largo × 18 ms, entre 1,5 y 5 s. Pausa entre partes: 0,7–2,5 s.
- Formato WhatsApp: *negrita* con un asterisco, sin # ni enlaces markdown.

## Seguimientos
- Lunes a sábado 08:00–18:00 (hora de Honduras), máximo 5 por hora, 2 min de separación, máximo 2 pasos (24 h y 168 h).
- El paso de "urgencia / alta demanda" no se usa.
- Con el bot pausado no hay seguimiento. Al cerrar el contacto se cancelan. Si algo falla, no se reintenta ni se manda un texto genérico (antes salían mensajes que no venían al caso).

## Guardias
- Precios: solo L 6,500, L 8,500 y L 2,000/año desde el 2.º año; pago 50/50. Cualquier otra cifra se quita.
- Una sola pregunta por mensaje; no repetir preguntas no respondidas; la demo se ofrece máximo 2 veces y nunca con las mismas palabras.
- Si pide una persona o cotización formal: escalar de inmediato, sin pedir datos antes. Nunca decir "ya te pasé" si la escalación falló. Nunca rellenar datos con "N/A".
- No calificado (sin negocio real, reventa de IPTV/cuentas, sistema a medida): sin demo, sin escalar, sin seguimiento.
- Responder en el idioma del cliente.
