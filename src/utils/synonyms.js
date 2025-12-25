// 1. DICCIONARIO DE SINÓNIMOS (CEREBRO POLÍGLOTA EXTENDIDO) 🧠
export const SEARCH_CONCEPTS = {
  'castle': [
    'castle', 'castillo', 'schloss', 'chateau', 'château', 'burg', 
    'fortress', 'festung', 'alcazar', 'castello', 'palace', 
    'palacio', 'palazzo', 'citadel', 'torre', 'tower', 'tour',
    'fortification', 'muralla', 'wall', 'defensa', 'bastion', 'castell'
  ],
  'ruins': [
    'ruins', 'ruinas', 'ruine', 'rovina', 'archaeological', 'yacimiento',
    'remains', 'restos', 'excavation', 'excavacion', 'antiquity', 'antigua', 
    'piedras', 'stones', 'abandoned', 'site'
  ],
  'museum': [
    'museum', 'museo', 'musée', 'gallery', 'galeria', 'pinacoteca',
    'collection', 'coleccion', 'exhibition', 'exhibicion', 'art', 'arte'
  ]
};

// 2. FUNCIÓN DE EXPANSIÓN
// Input: "Schloss" -> Output: ["castle", "schloss", "castillo"...]
export const getExpandedSearchTerms = (input) => {
  if (!input) return [];
  const lowerInput = input.toLowerCase().trim();

  // 1. ¿Es una de nuestras palabras clave? (Ej: busca "fortaleza")
  for (const [englishKey, variations] of Object.entries(SEARCH_CONCEPTS)) {
    if (variations.includes(lowerInput)) {
      // Devolvemos TODA la lista de sinónimos para buscar todo a la vez
      return variations;
    }
  }
  
  // 2. Si no es una palabra clave (Ej: busca "Valencia"), devolvemos solo esa palabra
  return [lowerInput];
};