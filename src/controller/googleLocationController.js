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
    return ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document', 'shop', 'store', 'hotel', 'restaurant'].some(w => lowerText.includes(w));
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
  
  // 🌍 RADIO AMPLIO: 10km (Mantenido igual)
  const googleRadius = 30000; 

  if (!lat || !lon) return res.status(400).json({ error: "Faltan coordenadas (lat, lon)" });

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
            id: 'debug-1',
            name: `Sin resultados para ${targetCategory}`,
            description: 'Intenta buscar una ciudad manualmente o muévete a otra zona.',
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            image_url: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5',
            category: 'System', 
            source: 'db',
            country: 'Tu Ubicación'
        }]);
    }

    res.json(filtered);

  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
};

// --- Auxiliar DB ---
async function fetchFromDatabase(lat, lon, maxKm = 20) {
  // 1. VALIDACIÓN DE SEGURIDAD 🛡️
  // Si lat o lon son undefined, null, o no son números, NO ejecutamos SQL.
  if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
      console.warn("⚠️ fetchFromDatabase: Coordenadas inválidas recibidas:", { lat, lon });
      return []; // Retornamos array vacío para no romper la app
  }

  // 2. CONVERSIÓN A NÚMEROS REALES
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

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
      LIMIT 20
    `;

    // Pasamos los números ya limpios (latNum, lonNum)
    const r = await db.raw(query, [latNum, lonNum, latNum, latNum, lonNum, latNum, maxKm]);
    
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
      category: row.category || 'Others' 
    }));
  } catch (err) { 
    console.error("🔥 Error CRÍTICO en DB:", err.message); 
    return []; 
  }
}

// --- Auxiliar Google ---
async function fetchFromGoogle(lat, lon, radius, category) {
  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const queryText = CATEGORY_QUERIES[category] || CATEGORY_QUERIES['All'];

    const requestBody = {
      textQuery: queryText,
      maxResultCount: 20,
      // LocationBias mantenido igual
      locationBias: {
        circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: radius }
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary,places.types' 
    };

    const response = await axios.post(url, requestBody, { headers });
    const places = response.data.places || [];

    const enrichedData = await Promise.all(places.map(async (p) => {
        const pLat = p.location.latitude;
        const pLon = p.location.longitude;
        const pName = p.displayName?.text;

        if (isInvalidContext(pName)) return null;

        let finalDesc = p.editorialSummary?.text || p.formattedAddress;
        let finalImage = p.photos?.[0] ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600` : null;
        let wikiTitle = null;

        const wikiData = await getWikipediaSummary(pLat, pLon, pName);
        if (wikiData) {
            if (wikiData.description) finalDesc = wikiData.description;
            if (!finalImage && wikiData.imageUrl) finalImage = wikiData.imageUrl;
            wikiTitle = wikiData.title;
        }

        let shortAddress = p.formattedAddress;
        if (shortAddress && shortAddress.split(',').length >= 2) {
            shortAddress = shortAddress.split(',').slice(-2).join(',').trim();
        }

        const detectedCat = detectCategory(p.types, pName, finalDesc);

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
// src/controllers/locationsController.js

export const suggestLocation = async (req, res) => {
  const { name, description, latitude, longitude, image_url, user_id, google_place_id, category, location_text } = req.body;

  try {
    // Validación: Si viene un google_place_id, verificamos duplicados
    if (google_place_id) {
       const check = await db.raw('SELECT id FROM historical_locations WHERE google_place_id = ?', [google_place_id]);
       if (check.rows.length > 0) return res.status(400).json({ error: "Ya registrado." });
    }

    const finalCategory = category || 'Others';
    const finalLocationText = location_text || 'Unknown Location';
    
    // 👇 CORRECCIÓN AQUÍ: Si es undefined, lo forzamos a null
    const finalGoogleId = google_place_id || null; 

    const newLoc = await db.raw(
      `INSERT INTO historical_locations 
       (name, description, latitude, longitude, image_url, created_by_user_id, is_approved, google_place_id, category, location_text) 
       VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?) 
       RETURNING *`,
      [
        name, 
        description, 
        latitude, 
        longitude, 
        image_url, 
        user_id, 
        finalGoogleId, // <--- Usamos la variable segura aquí (índice 6)
        finalCategory, 
        finalLocationText
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
export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    if (!textQuery && !lat) return res.status(400).json({ error: 'Faltan datos' });

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const categorySearchTerm = CATEGORY_QUERIES[selectedCategory] || CATEGORY_QUERIES['All'];
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
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary,places.types'
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

            const wikiData = await getWikipediaSummary(pLat, pLon, pName);
            if (wikiData) {
                if (wikiData.description) finalDesc = wikiData.description;
                if (!finalImage && wikiData.imageUrl) finalImage = wikiData.imageUrl;
                wikiTitle = wikiData.title;
            }
            
            let shortAddress = p.formattedAddress;
            if (shortAddress && shortAddress.split(',').length >= 2) {
                shortAddress = shortAddress.split(',').slice(-2).join(',').trim();
            }

            const detectedCat = detectCategory(p.types, pName, finalDesc);

            return {
                id: p.id, name: pName, description: finalDesc, latitude: pLat, longitude: pLon,
                image_url: finalImage || 'https://via.placeholder.com/400x300',
                category: detectedCat,
                source: 'google', google_place_id: p.id,
                address: p.formattedAddress, country: shortAddress, wiki_title: wikiTitle
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
// ==========================================
// 📖 4. WIKIPEDIA DETALLE (RESUMEN + LINK)
// ==========================================
export const getWikiFullDetails = async (req, res) => {
    const { title } = req.query;
    
    if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });
    
    try {
        // 👇 CAMBIO CLAVE: Usamos el buscador inteligente (generator=search) en lugar de búsqueda exacta (titles=)
        const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|info&exintro=1&explaintext=1&inprop=url&generator=search&gsrsearch=${encodeURIComponent(title)}&gsrlimit=1&origin=*`;
        
        // Usamos tus WIKI_OPTS que ya tienen el User-Agent anti-403 🛡️
        const response = await axios.get(url, WIKI_OPTS);
        
        const pages = response.data?.query?.pages;
        
        // Si Wikipedia no encuentra nada que se le parezca, devolvemos 404
        if (!pages) {
            return res.status(404).json({ error: "No encontrado" });
        }
        
        // Tomamos el ID del primer artículo que el buscador de Wikipedia consideró como la mejor coincidencia
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];

        res.json({ 
            full_description: pageData.extract, // Resumen
            wiki_url: pageData.fullurl          // Enlace
        });

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