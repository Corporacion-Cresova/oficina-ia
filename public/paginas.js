// Paginación para listas largas.
export const pagina = (lista, pag, tam) => lista.slice(pag * tam, (pag + 1) * tam);
export function controles(total, pag, tam, attr) {
  if (total <= tam) return '';
  const ult = Math.ceil(total / tam) - 1;
  return `<div class="pg"><button class="btn sm" ${attr}="${pag - 1}" ${pag <= 0 ? 'disabled' : ''}>Anterior</button><span>${pag * tam + 1} a ${Math.min(total, (pag + 1) * tam)} de ${total}</span><button class="btn sm" ${attr}="${pag + 1}" ${pag >= ult ? 'disabled' : ''}>Siguiente</button></div>`;
}
