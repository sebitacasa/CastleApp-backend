import axios from 'axios';
import db from '../config/db.js'; 

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// 👇 CONFIGURACIÓN ANTI-BLOQUEO WIKIPEDIA
const WIKI_OPTS = {
    headers: { 
        'User-Agent': 'CastleApp/1.0 (Educational Project)',
        'Api-User-Agent': 'CastleApp/1.0'
    },
    timeout: 5000
};

// ==========================================
// 🧠 LÓGICA DE CLASIFICACIÓN
// ==========================================
const detectCategory = (googleTypes = [], name = "", description = "") => {
    const text = (name + " " + description).toLowerCase();
    const types = (googleTypes || []).map(t => t.toLowerCase());

    if (text.includes("stolperstein")) return "Stolperstein";
    if (text.includes("plaque") || text.includes("placa") || text.includes("marker")) return "Plaques";
    if (text.includes("bust of") || text.includes("busto")) return "Busts";
    
    if (text.includes("castle") || text.includes("castillo") || text.includes("fortress") || text.includes("palace") || text.includes("palacio") || text.includes("citadel")) return "Castles";
    
    if (text.includes("ruin") || text.includes("ruinas") || text.includes("archaeological")) return "Ruins";
    if (text.includes("museum") || text.includes("museo") || text.includes("gallery") || text.includes("galería") || text.includes("exhibition")) return "Museums";
    
    if (text.includes("church") || text.includes("iglesia") || text.includes("cathedral") || text.includes("catedral") || text.includes("temple") || text.includes("synagogue") || text.includes("mosque")) return "Religious";
    
    if (text.includes("tower") || text.includes("torre") || text.includes("clock") || text.includes("reloj") || text.includes("bell")) return "Towers";

    if (types.includes("castle") || types.includes("fortress")) return "Castles";
    if (types.includes("museum") || types.includes("art_gallery")) return "Museums";
    if (types.includes("church") || types.includes("place_of_worship") || types.includes("hindu_temple") || types.includes("synagogue") || types.includes("mosque")) return "Religious";
    if (types.includes("monument") || types.includes("sculpture") || types.includes("statue")) return "Statues";
    if (types.includes("historical_landmark") || types.includes("historic_site")) return "Historic Site";
    
    if (types.includes("park") || types.includes("town_square") || types.includes("tourist_attraction") || types.includes("point_of_interest")) return "Tourist";

    return "Others";
};

// ==========================================
// 🏰 DICCIONARIO DE BÚSQUEDA
// ==========================================
const CATEGORY_QUERIES = {
    'All': "tourist attractions, historical landmarks, museums, castles, parks, monuments, squares, church, towers, ruins",
    'Castles': "Castles, palaces, fortresses, citadels",
    'Ruins': "Ancient ruins, archaeological sites, historic ruins",
    'Museums': "Museums, art galleries, exhibitions",
    'Statues': "Statues, sculptures, monuments",
    'Plaques': "Historical plaques, commemorative markers, blue plaques",
    'Busts': "Busts, sculptures of heads, historical busts",
    'Stolperstein': "Stolperstein, stumbling stones, memorial stones",
    'Historic Site': "Historical landmarks, heritage sites, ancient sites",
    'Religious': "Churches, cathedrals, temples, synagogues, mosques",
    'Towers': "Historic towers, clock towers, bell towers, observation towers",
    'Tourist': "Tourist attractions, town squares, parks, points of interest",
    'Others': "Hidden gems, landmarks, interesting places"
};

// ==========================================
// 🧹 HELPERS
// ==========================================
const isInvalidContext = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return ['clothing', 'shop', 'hotel', 'restaurant', 'store', 'cafe'].some(w => lower.includes(w));
};

const getWikipediaSummary = async (lat, lon, name) => {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=500&gslimit=1&format=json&origin=*`;
        const searchRes = await axios.get(searchUrl, WIKI_OPTS);
        const geoResult = searchRes.data.query?.geosearch?.[0];
        
        if (geoResult) {
            const detailsUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro&explaintext&piprop=original&titles=${encodeURIComponent(geoResult.title)}&format=json&origin=*`;
            const detailsRes = await axios.get(detailsUrl, WIKI_OPTS);
            const pages = detailsRes.data.query.pages;
            const pageId = Object.keys(pages)[0];
            const pageData = pages[pageId];
            return {
                title: geoResult.title,
                description: pageData.extract ? pageData.extract.substring(0, 300) + "..." : null,
                imageUrl: pageData.original?.source || null
            };
        }
        return null;
    } catch (error) { return null; }
};

// ==========================================
// 🗺️ 1. MAPA HÍBRIDO (GET /)
// ==========================================
export const getLocations = async (req, res) => {
  const { lat, lon, category } = req.query;
  const targetCategory = category || 'All';
  const googleRadius = 15000; // Radio 15km

  if (!lat || !lon) return res.status(400).json({ error: "Faltan coordenadas" });

  try {
    const [dbResults, googleResults] = await Promise.all([
      fetchFromDatabase(lat, lon, 20),
      fetchFromGoogle(lat, lon, googleRadius, targetCategory)
    ]);

    const combined = [...dbResults, ...googleResults];

    const filtered = targetCategory === 'All' 
        ? combined 
        : combined.filter(item => item.category === targetCategory);

    if (filtered.length === 0) {
        return res.json([{
            id: 'debug-1', name: `No hay ${targetCategory} cerca`,
            description: `No hay resultados en un radio de 15km. Intenta moverte o cambiar de categoría.`,
            latitude: parseFloat(lat), longitude: parseFloat(lon),
            image_url: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5',
            category: 'System', source: 'db', country: 'Tu Ubicación'
        }]);
    }

    res.json(filtered);

  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
};

// --- Auxiliar DB ---
async function fetchFromDatabase(lat, lon, maxKm) {
  try {
    const query = `
      SELECT *, 
      (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) AS distance
      FROM historical_locations
      WHERE is_approved = TRUE
      AND (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) < ? 
      ORDER BY distance ASC LIMIT 20
    `;
    const r = await db.raw(query, [lat, lon, lat, lat, lon, lat, maxKm]);
    
    return r.rows.map(row => ({
      id: row.id.toString(), name: row.name, description: row.description,
      latitude: row.lat, longitude: row.lon, image_url: row.image_url,
      source: 'db', is_yours: true, country: 'Community',
      category: detectCategory([], row.name, row.description)
    }));
  } catch (err) { return []; }
}

// --- Auxiliar Google ---
async function fetchFromGoogle(lat, lon, radius, category) {
  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const queryText = CATEGORY_QUERIES[category] || CATEGORY_QUERIES['All'];

    const requestBody = {
      textQuery: queryText,
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: radius }
      }
    };

    const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': '*' };

    const response = await axios.post(url, requestBody, { headers });
    const places = response.data.places || [];

    const enrichedData = await Promise.all(places.map(async (p) => {
        const pName = p.displayName?.text;
        if (isInvalidContext(pName)) return null;

        let finalDesc = p.editorialSummary?.text || p.formattedAddress;
        let finalImage = p.photos?.[0] ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600` : null;
        let wikiTitle = null;

        const wikiData = await getWikipediaSummary(p.location.latitude, p.location.longitude, pName);
        if (wikiData) {
            if (wikiData.description) finalDesc = wikiData.description;
            if (!finalImage && wikiData.imageUrl) finalImage = wikiData.imageUrl;
            wikiTitle = wikiData.title;
        }

        let shortAddress = p.formattedAddress;
        if (shortAddress && shortAddress.split(',').length >= 2) shortAddress = shortAddress.split(',').slice(-2).join(',').trim();

        return {
            id: p.id, name: pName, description: finalDesc, latitude: p.location.latitude, longitude: p.location.longitude,
            image_url: finalImage || 'https://via.placeholder.com/400x300',
            category: detectCategory(p.types, pName, finalDesc),
            source: 'google', google_place_id: p.id, address: p.formattedAddress, country: shortAddress, wiki_title: wikiTitle
        };
    }));

    return enrichedData.filter(item => item !== null);
  } catch (err) { return []; }
}

// ==========================================
// 📖 4. WIKIPEDIA DETALLE (RESUMEN + LINK)
// ==========================================
export const getWikiFullDetails = async (req, res) => {
    const { title } = req.query;
    if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });
    try {
        // 👇 CAMBIOS CLAVE:
        // 1. prop=extracts|info -> Pedimos texto e información
        // 2. exintro -> Pedimos SOLO la introducción (sin la historia completa)
        // 3. inprop=url -> Pedimos la URL oficial del artículo
        const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro&explaintext&inprop=url&titles=${encodeURIComponent(title)}&format=json&origin=*`;
        
        const response = await axios.get(url, WIKI_OPTS);
        
        const pages = response.data.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pageId === "-1") return res.status(404).json({ error: "No encontrado" });
        
        const pageData = pages[pageId];

        res.json({ 
            full_description: pageData.extract, // Ahora es solo el resumen limpio
            wiki_url: pageData.fullurl          // URL para el botón "Leer más"
        });

    } catch (error) { 
        console.error("Wiki Error:", error.message);
        res.status(500).json({ error: error.message }); 
    }
};

// ... (EXPORTACIONES RESTANTES) ...
export const suggestLocation = async (req, res) => { /* ... */ };
export const getGoogleLocations = async (req, res) => { /* ... */ };
export const getPendingLocations = async (req, res) => { res.json([]) };
export const approveLocation = async (req, res) => { res.json({}) };
export const rejectLocation = async (req, res) => { res.json({}) };