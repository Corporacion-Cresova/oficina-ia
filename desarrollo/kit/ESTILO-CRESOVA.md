# Estilo Cresova: lo que Diego aprueba (léelo PRIMERO, manda sobre las skills)

Diego compara cada demo con las que hace en Lovable. Sus clientes son negocios locales de Honduras (talleres, restaurantes, clínicas, abogados, tiendas) y lo que **vende** es una página con **impacto comercial**: que el dueño la abra y diga "¡wow, esa es mi empresa!". Una página sobria, plana o "de diseñador minimalista" **pierde** contra Lovable, aunque esté bien hecha.

Las skills de diseño (`frontend-design`, `design-taste`, `ai-tells-catalog`) sirven para que la página no sea una plantilla genérica: dirección propia, contenido real del negocio, nada de relleno. **No** sirven para hacerla austera. Si una skill dice "evitá degradados, íconos o efectos" y eso deja la página sin vida, gana esta guía: usá esos recursos **con intención y con los colores de la marca**.

## Lo que tiene que tener toda demo (lo que hace que Lovable se vea bien)
1. **Portada de impacto, a pantalla completa:**
   - foto grande del rubro de fondo, con una capa oscura o de color para que el texto se lea;
   - titular **enorme y en negrita** (fuente con carácter), con 1 o 2 palabras clave en el color de la marca;
   - una frase de apoyo, dos botones (WhatsApp destacado y un secundario) y 3 o 4 "chips" de confianza debajo ("Evaluación de daños", "San Pedro Sula", "Respuesta en minutos").
   - El primer pantallazo tiene que verse como un afiche, no como un documento.
2. **Identidad de marca fuerte:** logo arriba (si no hay logo, el nombre armado con tipografía de marca). Paleta con **1 color protagonista y 1 de acento que contrasten**, sacada del logo o del rubro. Fondos con carácter (oscuro elegante o de color), no blanco y beige en toda la página.
3. **Profundidad y acabado:**
   - tarjetas con esquinas redondeadas (`rounded-2xl`), sombra suave y borde sutil;
   - un efecto al pasar el mouse: se elevan, se agranda la imagen o se ilumina el borde;
   - íconos (lucide-react) en servicios y beneficios, dentro de un círculo o cuadrado del color de la marca;
   - degradados suaves de la marca en fondos de secciones clave o en los botones;
   - capas, fotos que sangran al borde y elementos que se superponen.
4. **Ritmo visual:** alterná secciones claras y oscuras (o de color). Cada 1–2 secciones, algo visual fuerte: una foto a todo ancho, una banda de color con números grandes, o una galería.
5. **Prueba social y confianza:** números grandes (años, clientes, trabajos), testimonios con estrellas, logos de aseguradoras o marcas con las que trabajan, garantía. Si no hay datos reales, verosímiles y marcados `// EJEMPLO: confirmar con el cliente`.
6. **Movimiento con gusto:**
   - entrada animada del hero (titular y botones);
   - números que cuentan al aparecer;
   - hover en tarjetas y botones;
   - un elemento flotante sutil (por ejemplo el botón de WhatsApp con un pulso).
   - Nada exagerado, pero que se sienta vivo.
7. **Cierre fuerte:** una banda final grande, de color o con foto, con el llamado a WhatsApp, el teléfono y el horario. Pie de página completo con logo, servicios, contacto, redes y mapa o dirección.

## Referencias de Diego (miralas con `mirar_referencia` antes de diseñar una demo nueva)
Son sitios que Diego hizo en Lovable y le gustan. Tomá de ahí **el nivel de impacto y acabado**: la portada, el contraste, las tarjetas, los colores con fuerza. No copies el diseño ni los textos.
- https://tinteyfriccion.cresova.com/ (taller automotriz: portada oscura con foto, titular gigante en dos colores, chips de confianza)
- https://georgerestaurant.cresova.com/ (restaurante)
- https://kennedybodden.cresova.com/ (despacho legal)
Mirá al menos una, la más cercana al rubro, y compará tus capturas contra ella antes de dar la demo por terminada.

## Calidad técnica (no negociable)
- Contraste legible (texto sobre foto siempre con capa), botones de al menos 44 px de alto en celular, nada que se corte en 390 px de ancho.
- Fotos livianas, `loading="lazy"` salvo la del hero, textos `alt` reales.
- Para el detalle fino, revisá `skills/web-interface-guidelines.md` (Vercel) y `skills/ui-pro-rules.md` (lista previa a la entrega).
