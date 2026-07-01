import axios from 'axios';
import countryLanguage from 'country-language';
import db from '../config/db.js';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// 👇 CONFIGURACIÓN ANTI-BLOQUEO WIKIPEDIA
// Wikimedia exige un User-Agent con URL o contacto real (ver
// https://meta.wikimedia.org/wiki/User-Agent_policy); un UA genérico como el
// que había antes ("CastleApp/1.0 (Educational Project)") puede ser
// bloqueado SIN AVISO por su WAF, sobre todo desde IPs de hosting/cloud como
// las de Railway — eso explicaría el 100% de fallos silenciosos que veíamos.
const WIKI_OPTS = {
    headers: {
        'User-Agent': 'CastleApp/1.0 (https://github.com/sebitacasa/CastleApp-backend; contact via GitHub issues)'
    },
    timeout: 6000
};

// ==========================================
// 🏰 TIPOS DE GOOGLE PLACES (API NUEVA) POR CATEGORÍA
// ==========================================
// Solo tipos estrictamente históricos/culturales + religiosos.
// Google no tiene un tipo "ruins" dedicado: para esa categoría buscamos en el
// mismo pool de landmarks históricos y afinamos por palabra clave en el nombre.
const HISTORIC_TYPE_GROUPS = {
    'Castles': ['castle'],
    'Historic Site': ['historical_landmark', 'historical_place', 'cultural_landmark', 'monument', 'sculpture'],
    'Ruins': ['historical_landmark', 'historical_place', 'cultural_landmark'],
    'Museums': ['museum', 'art_museum', 'history_museum', 'art_gallery'],
    'Religious': ['church', 'synagogue', 'mosque', 'hindu_temple', 'buddhist_temple', 'shinto_shrine'],
};

// Grupos que se consultan en paralelo cuando no hay un filtro de categoría específico
const DEFAULT_GROUPS = ['Castles', 'Historic Site', 'Museums', 'Religious'];

const getGroupsForCategory = (category) => {
    if (category && HISTORIC_TYPE_GROUPS[category]) return [category];
    return DEFAULT_GROUPS;
};

// Mapeo directo: tipo de Google -> categoría de la app
const TYPE_TO_CATEGORY = {
    castle: 'Castles',
    historical_landmark: 'Historic Site',
    historical_place: 'Historic Site',
    cultural_landmark: 'Historic Site',
    monument: 'Statues',
    sculpture: 'Statues',
    museum: 'Museums',
    art_museum: 'Museums',
    history_museum: 'Museums',
    art_gallery: 'Museums',
    church: 'Religious',
    synagogue: 'Religious',
    mosque: 'Religious',
    hindu_temple: 'Religious',
    buddhist_temple: 'Religious',
    shinto_shrine: 'Religious',
};

const RUIN_KEYWORDS = ['ruin', 'ruina', 'ruines', 'rovina', 'trosky', 'rudera'];

// ==========================================
// 🧠 LÓGICA DE CLASIFICACIÓN
// ==========================================
// Prioriza el tipo real que devuelve Google (primaryType/types) sobre
// adivinar por palabras en el nombre — solo usamos keywords para "Ruins",
// que Google no modela como tipo propio.
const detectCategory = (primaryType, googleTypes = [], name = "") => {
    const nameLower = (name || "").toLowerCase();
    if (RUIN_KEYWORDS.some(k => nameLower.includes(k))) return 'Ruins';

    if (primaryType && TYPE_TO_CATEGORY[primaryType]) return TYPE_TO_CATEGORY[primaryType];

    const types = googleTypes || [];
    for (const t of types) {
        if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
    }

    return 'Historic Site';
};

// ==========================================
// 🧹 HELPERS
// ==========================================
// 🐛 OJO: antes esto usaba .includes(), que es un substring match ciego.
// "shop" matchea dentro de "archbishop" y "store" matchea dentro de "restored" —
// dos palabras que aparecen constantemente en artículos legítimos sobre iglesias
// y sitios históricos restaurados, así que se estaban descartando como "basura"
// la mayoría de las descripciones de catedrales y monumentos. Con \b (límite de
// palabra) solo matchea la palabra suelta "shop"/"store", no como substring.
const INVALID_CONTEXT_WORDS = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document', 'shop', 'store', 'hotel', 'restaurant'];
const INVALID_CONTEXT_REGEX = new RegExp(`\\b(${INVALID_CONTEXT_WORDS.join('|')})\\b`, 'i');
const isInvalidContext = (text) => {
    if (!text) return false;
    return INVALID_CONTEXT_REGEX.test(text);
};

// Palabras genéricas (honoríficos, términos arquitectónicos y preposiciones)
// que aparecen en decenas de lugares distintos y por sí solas no prueban nada:
// media Roma se llama "Santa Maria algo" o "Basilica di algo". Confirmado en
// vivo contra producción: buscar "Santa Maria della Vittoria" matcheaba con el
// artículo de "Santa Maria Maggiore", y "Santa Maria in Trastevere" con el de
// "Santa Cecilia in Trastevere" -- ambos comparten solo "santa"/"basilica"/
// "maria", nunca la palabra que realmente distingue un lugar del otro.
//
// También pasa con castillos/fortificaciones: Google le puso "Castello della
// Cervelletta" a un lugar cuyo artículo real de Wikipedia se llama "Casale
// della Cervelletta" (Google lo clasificó como castillo, Wikipedia lo describe
// como casa de campo/finca fortificada). "Castello" es tan genérico y no-
// discriminante para este dominio como "Basilica", así que se suman los
// descriptores de tipo de edificio de las categorías que maneja la app
// (castillos, ruinas, museos, sitios religiosos) en varios idiomas.
const GENERIC_WORDS = [
    'saint', 'santo', 'santa', 'santi', 'san', 'sant', 'st',
    'basilica', 'chiesa', 'church', 'cathedral', 'cattedrale', 'duomo',
    'papal', 'pontificio', 'pontifical', 'santuario', 'sanctuary', 'shrine',
    'abbey', 'abbazia', 'monastery', 'monastero', 'convent', 'convento',
    'temple', 'tempio', 'chapel', 'cappella', 'hermitage', 'eremo',
    'castle', 'castello', 'chateau', 'château', 'schloss', 'burg',
    'palace', 'palazzo', 'palais', 'villa', 'casale', 'manor', 'maniero', 'mansion',
    'tower', 'torre', 'turm', 'fort', 'fortress', 'fortezza', 'festung',
    'citadel', 'cittadella', 'rocca', 'stronghold', 'keep',
    'ruins', 'ruina', 'rovina', 'rovine',
    'museum', 'museo', 'gallery', 'galleria',
    'of', 'the', 'and', 'in', 'di', 'dei', 'degli', 'della', 'del', 'la', 'le', 'il', 'e',
];

// Compara el nombre del lugar (Google) contra el título de Wikipedia encontrado,
// para evitar quedarnos con un artículo que no es realmente sobre ese lugar.
const areNamesSimilar = (placeName, wikiTitle) => {
    if (!placeName || !wikiTitle) return false;
    // 👇 \p{L}\p{N} (letras/números Unicode), NO a-z0-9: la versión anterior
    // solo dejaba ASCII, así que nombres en japonés/coreano/árabe/etc. quedaban
    // reducidos a string vacío y la validación rechazaba SIEMPRE, aunque el
    // título de Wikipedia fuera idéntico (confirmado en vivo: "姫路城" contra
    // el artículo "姫路城" -- mismo texto -- se rechazaba por string vacío).
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^\p{L}\p{N} ]/gu, " ").trim();
    const a = norm(placeName);
    const b = norm(wikiTitle);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;

    const bWords = b.split(' ');
    const aWords = a.split(' ').filter(w => w.length >= 4);
    const significantWords = aWords.filter(w => !GENERIC_WORDS.includes(w));

    // Nombre puramente genérico (ej. solo "Santa Maria"): no hay palabra
    // distintiva que validar, caemos al chequeo laxo de antes.
    if (significantWords.length === 0) return aWords.some(w => bWords.includes(w));

    // Todas las palabras distintivas deben aparecer en el título candidato --
    // ya no alcanza con compartir "santa"/"basilica" para darlo por bueno.
    return significantWords.every(w => bWords.includes(w));
};

// ==========================================
// 🌍 IDIOMA LOCAL DE WIKIPEDIA SEGÚN EL PAÍS
// ==========================================
// Google devuelve los nombres de lugares en su idioma local (ej: "Burgruine
// Aggstein" en vez de "Aggstein Castle"), así que buscar SIEMPRE en Wikipedia
// en inglés fallaba para la mayoría de los lugares fuera de países de habla
// inglesa. Antes esto era una lista a mano de ~30 países (mayormente
// Europa); cualquier país fuera de esa lista (Japón, Egipto, India, etc.)
// caía directo a inglés. Ahora se usa "country-language" (dataset de
// idiomas oficiales/hablados por país vía ISO 3166-1) para cubrir los ~195
// países sin mantener una lista manual, y se prueban varios candidatos
// -- en países multilingües (Suiza, Bélgica, India) no hay forma confiable
// de saber "el" idioma correcto sin mirar el nombre real del lugar, así que
// se intentan hasta 3 antes de caer a inglés.
//
// getCountryLanguages() sola devuelve los idiomas de un país en un orden que
// NO refleja cuál es el dominante -- para Italia daba [fr, de, it], porque
// francés/alemán son cooficiales en regiones (Valle de Aosta, Tirol del Sur)
// pero la librería no pondera por población. Se reordena usando
// getCountry().languages, que sí trae cuántos países más hablan cada idioma
// (.countries.length): un idioma "exclusivo" de pocos países (como el
// italiano) es más probable que sea EL idioma nacional que uno compartido
// por decenas (como el francés), así que se prueba primero.
const getWikiLangsForCountry = (countryCode) => {
    if (!countryCode) return [];
    const langs = countryLanguage.getCountry(countryCode)?.languages || [];
    const sorted = [...langs].sort((a, b) => (a.countries?.length || 0) - (b.countries?.length || 0));
    const codes = sorted.map(l => l.iso639_1).filter(Boolean);
    return [...new Set(codes)].filter(c => c !== 'en').slice(0, 3);
};

// Extrae el código ISO-2 del país (ej. "IT") de los addressComponents que
// devuelve Google Places API (New) -- mucho más confiable que parsear texto
// libre de formattedAddress, que varía de formato según el país.
const extractCountryCode = (addressComponents) => {
    if (!Array.isArray(addressComponents)) return null;
    const countryComp = addressComponents.find(c => c.types?.includes('country'));
    return countryComp?.shortText || null;
};

// Trae título + extracto COMPLETO (sin truncar) + imagen + url de un artículo
// YA IDENTIFICADO (no busca, no valida relevancia).
const fetchWikipediaArticle = async (title, lang) => {
    const baseUrl = `https://${lang}.wikipedia.org/w/api.php`;
    const detailsUrl = `${baseUrl}?action=query&prop=extracts|pageimages|info&exintro&explaintext&piprop=original&inprop=url&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const detailsRes = await axios.get(detailsUrl, WIKI_OPTS);
    const pages = detailsRes.data?.query?.pages;
    if (!pages) return null;
    const pageId = Object.keys(pages)[0];
    if (pageId === '-1' || !pages[pageId].extract) return null;
    const pageData = pages[pageId];
    return {
        title: pageData.title || title,
        extract: pageData.extract,
        imageUrl: pageData.original?.source || null,
        wikiUrl: pageData.fullurl || null,
    };
};

// 🔎 Núcleo ÚNICO de búsqueda: busca por nombre en un idioma, VALIDA que el
// título encontrado sea relevante (areNamesSimilar) y, si no es inglés,
// intenta saltar a la versión en inglés vía langlinks (también validada, ya
// que viene del mismo título ya confirmado). Devuelve { article, isEnglish }
// (isEnglish indica si se llegó a un artículo en inglés, vía jump o porque
// lang ya era 'en') o null si no hay nada confiable.
//
// OJO: toda búsqueda en Wikipedia debe pasar por esta función. Antes existía
// un segundo camino sin chequeo de relevancia (usado por el botón "Read
// More"), y eso causaba que p. ej. buscar "St. Stephen's Cathedral" en
// Wikipedia en alemán devolviera el artículo de "Brisbane" (porque ahí se
// menciona una catedral con ese nombre) y se mostrara como si fuera la
// historia de la catedral de Viena.
const resolveWikipediaArticle = async (name, lang) => {
    const baseUrl = `https://${lang}.wikipedia.org/w/api.php`;
    const searchUrl = `${baseUrl}?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1&origin=*`;
    const searchRes = await axios.get(searchUrl, WIKI_OPTS);
    const title = searchRes.data?.query?.search?.[0]?.title;

    if (!title || !areNamesSimilar(name, title)) return null;

    if (lang !== 'en') {
        const langlinksUrl = `${baseUrl}?action=query&prop=langlinks&lllang=en&titles=${encodeURIComponent(title)}&format=json&origin=*`;
        const langRes = await axios.get(langlinksUrl, WIKI_OPTS);
        const langPages = langRes.data?.query?.pages;
        const langPageId = langPages ? Object.keys(langPages)[0] : null;
        const enTitle = langPageId ? (langPages[langPageId].langlinks?.[0]?.['*'] || langPages[langPageId].langlinks?.[0]?.title) : null;

        if (enTitle) {
            const enArticle = await fetchWikipediaArticle(enTitle, 'en');
            if (enArticle) return { article: enArticle, isEnglish: true };
        }
    }

    const localArticle = await fetchWikipediaArticle(title, lang);
    return localArticle ? { article: localArticle, isEnglish: lang === 'en' } : null;
};

// Prueba los idiomas candidatos del país (ej. alemán para Austria), porque
// Google entrega los nombres en el idioma local. El orden que da la librería
// de idiomas por país no siempre es "el idioma dominante primero" (ej. Italia
// devuelve francés y alemán antes que italiano, por las minorías de Valle de
// Aosta y Tirol del Sur) -- confirmado en vivo: "Castello della Cervelletta"
// encontraba un stub en FRANCÉS sin link a inglés y se mostraba tal cual en
// vez de intentar italiano/inglés. Por eso no nos quedamos con el primer
// candidato que responda algo: seguimos probando hasta encontrar uno que
// llegue a inglés, y solo si NINGUNO lo logra devolvemos el primer resultado
// en idioma local que haya salido válido.
const resolveWikipediaArticleForCountry = async (name, countryCode) => {
    const candidateLangs = getWikiLangsForCountry(countryCode);
    let localFallback = null;
    for (const lang of candidateLangs) {
        const result = await resolveWikipediaArticle(name, lang);
        if (result?.isEnglish) return result.article;
        if (result && !localFallback) localFallback = result.article;
    }
    const enResult = await resolveWikipediaArticle(name, 'en');
    if (enResult) return enResult.article;
    return localFallback;
};

// 🔎 Busca en Wikipedia POR NOMBRE (no por coordenadas), con la descripción
// truncada a 300 caracteres para usarse en las cards del feed. Si no hay
// nada confiable, devuelve null y el caller se queda con los datos por
// defecto que ya trae Google.
const getWikipediaByName = async (name, countryCode) => {
    if (!name) return null;
    try {
        const article = await resolveWikipediaArticleForCountry(name, countryCode);
        if (!article) return null;

        const description = article.extract.substring(0, 300) + "...";
        if (isInvalidContext(description)) return null;

        return { title: article.title, description, imageUrl: article.imageUrl };
    } catch (error) {
        console.error(`🔥 Wikipedia lookup "${name}" (${countryCode}):`, error.response?.status || error.message);
        return null;
    }
};

// ==========================================
// 🗺️ 1. MAPA HÍBRIDO (GET /)
// ==========================================
export const getLocations = async (req, res) => {
  const { lat, lon, category } = req.query;
  const targetCategory = category || 'All';
  const currentPage = parseInt(req.query.page, 10) || 1;

  // 🌍 Nearby Search admite hasta 50km de radio (es el máximo permitido por Google)
  const googleRadius = 50000;

  if (!lat || !lon) return res.status(400).json({ error: "Faltan coordenadas (lat, lon)" });

  try {
    // 💡 1. Paginación en la Base de Datos (ya viene acotada a 50km por la
    // formula de Haversine en el WHERE de fetchFromDatabase — un lugar
    // subido en Haag nunca puede aparecer para alguien a 1300km en Barcelona).
    const dbResults = await fetchFromDatabase(lat, lon, 50, currentPage);

    // 💡 2. Google Nearby Search (Places API New no soporta pageToken en Nearby Search,
    // así que solo se consulta en la página 1; las siguientes páginas solo paginan la DB)
    // La categoría "Community" es 100% lugares subidos por usuarios (dbResults),
    // así que ni vale la pena pedirle nada a Google para ese caso.
    let googlePlaces = [];
    if (currentPage === 1 && targetCategory !== 'Community') {
        googlePlaces = await fetchFromGoogle(lat, lon, googleRadius, targetCategory);
    }

    const combined = [...dbResults, ...googlePlaces];

    let filtered;
    if (targetCategory === 'All') {
        filtered = combined;
    } else if (targetCategory === 'Community') {
        // 🐛 Antes el frontend ni mandaba ?category=Community (lo trataba como
        // "sin filtro"), así que esta pestaña mostraba TODO (DB + Google)
        // mezclado en vez de aislar solo los lugares de la comunidad.
        filtered = combined.filter(item => item.source === 'db');
    } else {
        filtered = combined.filter(item => item.category === targetCategory);
    }

    if (filtered.length === 0 && currentPage === 1) {
        return res.json({
            data: [{
                id: 'debug-1',
                name: `Sin resultados para ${targetCategory}`,
                description: 'Intenta buscar una ciudad manualmente o muévete a otra zona.',
                latitude: parseFloat(lat),
                longitude: parseFloat(lon),
                image_url: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5',
                category: 'System',
                source: 'db',
                country: 'Tu Ubicación'
            }],
            nextGoogleToken: null
        });
    }

    res.json({
        data: filtered,
        nextGoogleToken: null
    });

  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
};

// --- Auxiliar DB ---
async function fetchFromDatabase(lat, lon, maxKm = 50, page = 1) {
  if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
      console.warn("⚠️ fetchFromDatabase: Coordenadas inválidas recibidas:", { lat, lon });
      return [];
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  const limit = 20;
  const offset = (page - 1) * limit;

  try {
    const query = `
      SELECT *,
      (6371 * acos(
        cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) +
        sin(radians(?)) * sin(radians(latitude))
      )) AS distance
      FROM historical_locations
      WHERE is_approved = TRUE
      AND (6371 * acos(
        cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) +
        sin(radians(?)) * sin(radians(latitude))
      )) < ?
      ORDER BY distance ASC
      LIMIT ? OFFSET ?
    `;

    const r = await db.raw(query, [latNum, lonNum, latNum, latNum, lonNum, latNum, maxKm, limit, offset]);

    return r.rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      description: row.description,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      image_url: row.image_url,
      source: 'db',
      is_yours: true,
      country: row.location_text || 'Community',
      category: row.category || 'Others',
      distance: row.distance
    }));
  } catch (err) {
    console.error("🔥 Error CRÍTICO en DB:", err.message);
    return [];
  }
}

// --- Auxiliar Google: una llamada Nearby Search restringida a un set de tipos ---
async function searchNearbyByTypes(lat, lon, radius, types) {
    try {
        const url = 'https://places.googleapis.com/v1/places:searchNearby';
        const requestBody = {
            includedTypes: types,
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
            locationRestriction: {
                circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius }
            }
        };
        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.photos,places.editorialSummary,places.types,places.primaryType'
        };
        const response = await axios.post(url, requestBody, { headers });
        return response.data.places || [];
    } catch (err) {
        console.error(`🔥 ERROR Nearby Search [${types.join(',')}]:`, err.response?.data || err.message);
        return [];
    }
}

// --- Auxiliar Google: combina los grupos de tipos relevantes, deduplica y enriquece ---
async function fetchFromGoogle(lat, lon, radius, category) {
  try {
    const groupNames = getGroupsForCategory(category);
    const rawBatches = await Promise.all(
        groupNames.map(g => searchNearbyByTypes(lat, lon, radius, HISTORIC_TYPE_GROUPS[g]))
    );

    const seen = new Map();
    rawBatches.flat().forEach(p => { if (p?.id && !seen.has(p.id)) seen.set(p.id, p); });
    const places = Array.from(seen.values());

    const enrichedData = await Promise.all(places.map(async (p) => {
        const pLat = p.location.latitude;
        const pLon = p.location.longitude;
        const pName = p.displayName?.text;

        if (isInvalidContext(pName)) return null;

        let finalDesc = p.editorialSummary?.text || p.formattedAddress;
        let finalImage = p.photos?.[0] ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600` : null;
        let wikiTitle = null;

        const countryCode = extractCountryCode(p.addressComponents);
        const wikiData = await getWikipediaByName(pName, countryCode);
        if (wikiData) {
            if (wikiData.description) finalDesc = wikiData.description;
            if (!finalImage && wikiData.imageUrl) finalImage = wikiData.imageUrl;
            wikiTitle = wikiData.title;
        }

        let shortAddress = p.formattedAddress;
        if (shortAddress && shortAddress.split(',').length >= 2) {
            shortAddress = shortAddress.split(',').slice(-2).join(',').trim();
        }

        const detectedCat = detectCategory(p.primaryType, p.types, pName);

        return {
            id: p.id,
            name: pName,
            description: finalDesc,
            latitude: pLat,
            longitude: pLon,
            image_url: finalImage || 'https://via.placeholder.com/400x300',
            category: detectedCat,
            source: 'google',
            google_place_id: p.id,
            address: p.formattedAddress,
            country: shortAddress,
            country_code: countryCode,
            wiki_title: wikiTitle
        };
    }));

    return enrichedData.filter(item => item !== null);

  } catch (err) {
    console.error("🔥 ERROR GOOGLE API:", err.response?.data || err.message);
    return [];
  }
}

// ==========================================
// 📥 2. SUGERIR / GUARDAR (POST /suggest)
// ==========================================
export const suggestLocation = async (req, res) => {
  const { name, description, latitude, longitude, image_url, user_id, google_place_id, category, location_text } = req.body;

  try {
    if (google_place_id) {
       const check = await db.raw('SELECT id FROM historical_locations WHERE google_place_id = ?', [google_place_id]);
       if (check.rows.length > 0) return res.status(400).json({ error: "Ya registrado." });
    }

    const finalCategory = category || 'Others';
    const finalLocationText = location_text || 'Unknown Location';
    const finalGoogleId = google_place_id || null;

    const newLoc = await db.raw(
      `INSERT INTO historical_locations
       (name, description, latitude, longitude, image_url, created_by_user_id, is_approved, google_place_id, category, location_text)
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)
       RETURNING *`,
      [
        name, description, latitude, longitude, image_url, user_id, finalGoogleId, finalCategory, finalLocationText
      ]
    );

    res.json({ message: "Lugar creado", location: newLoc.rows[0] });

  } catch (err) {
    console.error("Error al guardar:", err.message);
    res.status(500).json({ error: "Error al guardar: " + err.message });
  }
};

// ==========================================
// 🔭 3. BÚSQUEDA DE TEXTO (GET /external/search)
// ==========================================
// Se mantiene basada en Text Search porque permite buscar por nombre libre
// (ej: "Eiffel Tower") sin depender de coordenadas, algo que Nearby Search no soporta.
const CATEGORY_SEARCH_TEXT = {
    'All': "historical landmarks, museums, castles, monuments, churches, cathedrals",
    'Castles': "Castles, palaces, fortresses, citadels",
    'Ruins': "Ancient ruins, archaeological sites, historic ruins",
    'Museums': "Museums, art galleries, history museums",
    'Historic Site': "Historical landmarks, heritage sites, cultural landmarks",
    'Religious': "Churches, cathedrals, temples, synagogues, mosques",
};

export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    if (!textQuery && !lat) return res.status(400).json({ error: 'Faltan datos' });

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const categorySearchTerm = CATEGORY_SEARCH_TEXT[selectedCategory] || CATEGORY_SEARCH_TEXT['All'];
        let finalQuery = textQuery ? `${categorySearchTerm} in ${textQuery}` : categorySearchTerm;

        let requestBody = { textQuery: finalQuery, maxResultCount: 20 };

        if (lat && lon) {
            requestBody.locationBias = {
                circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: 20000.0 }
            };
        }

        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.photos,places.editorialSummary,places.types,places.primaryType'
        };

        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

        const enrichedData = await Promise.all(googlePlaces.map(async (p) => {
            const pLat = p.location.latitude;
            const pLon = p.location.longitude;
            const pName = p.displayName?.text;

            if (isInvalidContext(pName)) return null;

            let finalDesc = p.editorialSummary?.text || p.formattedAddress;
            let finalImage = p.photos?.[0] ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600` : null;
            let wikiTitle = null;

            const countryCode = extractCountryCode(p.addressComponents);
            const wikiData = await getWikipediaByName(pName, countryCode);
            if (wikiData) {
                if (wikiData.description) finalDesc = wikiData.description;
                if (!finalImage && wikiData.imageUrl) finalImage = wikiData.imageUrl;
                wikiTitle = wikiData.title;
            }

            let shortAddress = p.formattedAddress;
            if (shortAddress && shortAddress.split(',').length >= 2) {
                shortAddress = shortAddress.split(',').slice(-2).join(',').trim();
            }

            const detectedCat = detectCategory(p.primaryType, p.types, pName);

            return {
                id: p.id, name: pName, description: finalDesc, latitude: pLat, longitude: pLon,
                image_url: finalImage || 'https://via.placeholder.com/400x300',
                category: detectedCat,
                source: 'google', google_place_id: p.id,
                address: p.formattedAddress, country: shortAddress, country_code: countryCode, wiki_title: wikiTitle
            };
        }));

        res.json({ data: enrichedData.filter(i => i !== null) });

    } catch (error) {
        res.status(500).json({ error: 'Error búsqueda externa' });
    }
};

// ==========================================
// 📖 4. WIKIPEDIA DETALLE (RESUMEN + LINK)
// ==========================================
export const getWikiFullDetails = async (req, res) => {
    // country_code: ISO-2 (ej. "IT"), viene del feed via extractCountryCode.
    // Clientes viejos de la app (que todavía mandan "country" en texto libre en
    // vez de "country_code") van a caer directo a inglés -- mismo
    // comportamiento que ya tenían cuando el país no se reconocía.
    const { title, country_code } = req.query;

    if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });

    try {
        // Usa el MISMO núcleo validado que el feed (resolveWikipediaArticleForCountry),
        // así "Read More" no puede traer un artículo irrelevante que el feed ya descartó.
        const article = await resolveWikipediaArticleForCountry(title, country_code);

        if (!article || isInvalidContext(article.extract)) {
            return res.status(404).json({ error: "No encontrado" });
        }

        res.json({ full_description: article.extract, wiki_url: article.wikiUrl });

    } catch (error) {
        console.error("Wiki Error Backend:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// 🛡️ 5. ADMIN
// ==========================================
export const getPendingLocations = async (req, res) => {
    try { const r = await db.raw('SELECT * FROM historical_locations WHERE is_approved = FALSE'); res.json(r.rows); }
    catch (e) { res.status(500).json({error: e.message}); }
};
export const approveLocation = async (req, res) => {
    try { await db.raw('UPDATE historical_locations SET is_approved = TRUE WHERE id = ?', [req.params.id]); res.json({msg: "OK"}); }
    catch (e) { res.status(500).json({error: e.message}); }
};
export const rejectLocation = async (req, res) => {
    try { await db.raw('DELETE FROM historical_locations WHERE id = ?', [req.params.id]); res.json({msg: "Deleted"}); }
    catch (e) { res.status(500).json({error: e.message}); }
};
