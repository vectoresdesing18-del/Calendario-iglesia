// Divisiones por pericopa (unidades literarias naturales) para asignación
// automática de pasajes de estudio, en orden canónico dentro de cada libro.
//
// Para agregar un libro nuevo, sigue el mismo patrón: una key con el nombre
// EXACTO que usarás en "Series" (ej. "Hebreos"), y un arreglo ordenado de
// { ref, title }.

export const PERICOPES = {
  "Hebreos": [
    { ref: "Hebreos 1:1-4", title: "Dios habla por medio de su Hijo" },
    { ref: "Hebreos 1:5-14", title: "El Hijo, superior a los ángeles" },
    { ref: "Hebreos 2:1-4", title: "Advertencia a no descuidar la salvación" },
    { ref: "Hebreos 2:5-18", title: "Jesús, hecho semejante a sus hermanos" },
    { ref: "Hebreos 3:1-6", title: "Jesús, superior a Moisés" },
    { ref: "Hebreos 3:7-19", title: "Advertencia a no endurecer el corazón" },
    { ref: "Hebreos 4:1-13", title: "El reposo que queda para el pueblo de Dios" },
    { ref: "Hebreos 4:14-16", title: "Jesús, nuestro gran sumo sacerdote" },
    { ref: "Hebreos 5:1-10", title: "Cristo, sacerdote según el orden de Melquisedec" },
    { ref: "Hebreos 5:11-6:12", title: "Advertencia contra la inmadurez y la apostasía" },
    { ref: "Hebreos 6:13-20", title: "La certeza de la promesa de Dios" },
    { ref: "Hebreos 7:1-28", title: "El sacerdocio de Melquisedec" },
    { ref: "Hebreos 8:1-13", title: "El mediador de un nuevo pacto" },
    { ref: "Hebreos 9:1-14", title: "El santuario terrenal y el celestial" },
    { ref: "Hebreos 9:15-28", title: "La sangre de Cristo purifica la conciencia" },
    { ref: "Hebreos 10:1-18", title: "El sacrificio de Cristo, ofrecido una sola vez" },
    { ref: "Hebreos 10:19-39", title: "Exhortación a la perseverancia" },
    { ref: "Hebreos 11:1-40", title: "Ejemplos de fe" },
    { ref: "Hebreos 12:1-13", title: "La disciplina de Dios como Padre" },
    { ref: "Hebreos 12:14-29", title: "Advertencia a no rechazar a Dios" },
    { ref: "Hebreos 13:1-25", title: "Exhortaciones y bendición final" }
  ],

  "2 Pedro": [
    { ref: "2 Pedro 1:1-11", title: "Partícipes de la naturaleza divina" },
    { ref: "2 Pedro 1:12-21", title: "La firmeza de la palabra profética" },
    { ref: "2 Pedro 2:1-22", title: "Advertencia contra los falsos maestros" },
    { ref: "2 Pedro 3:1-13", title: "La promesa del día del Señor" },
    { ref: "2 Pedro 3:14-18", title: "Exhortación final a crecer en la gracia" }
  ]
};

// Fallback genérico cuando el libro aún no tiene pericopas cargadas:
// sugiere capítulo por capítulo usando el total de "chapters" de la serie.
export function fallbackPericopes(serie) {
  const total = Math.max(1, Number(serie.chapters || 1));
  return Array.from({ length: total }, (_, i) => ({
    ref: `${serie.name} ${i + 1}`,
    title: ""
  }));
}

export function pericopesFor(serie) {
  return PERICOPES[serie.name] || fallbackPericopes(serie);
}

export function nextPericope(serie) {
  const list = pericopesFor(serie);
  const index = Number(serie.pericopeIndex || 0);
  if (index >= list.length) return null;
  return list[index];
}
