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
  // 💡 Extraemos page y pageToken
  const { lat, lon, category, page = 1, pageToken } = req.query;
  const targetCategory = category || 'All';
  const currentPage = parseInt(page, 10) || 1;
  
  // 🌍 RADIO AMPLIO PARA PAGINACIÓN: 50km
  const googleRadius = 50000; 

  if (!lat || !lon) return res.status(400).json({ error: "Faltan coordenadas (lat, lon)" });

  try {
    // 💡 1. Paginación en la Base de Datos
    const dbResults = await fetchFromDatabase(lat, lon, 50, currentPage);
    
    // 💡 2. Paginación en Google
    let googleData = { places: [], nextToken: null };
    // Solo pedimos a Google si es la página 1, o si tenemos un token para continuar
    if (currentPage === 1 || pageToken) {
        googleData = await fetchFromGoogle(lat, lon, googleRadius, targetCategory, pageToken);
    }

    const combined = [...dbResults, ...googleData.places];

    const filtered = targetCategory === 'All' 
        ? combined 
        : combined.filter(item => item.category === targetCategory);

    // Si es la página 1 y no hay nada, mostramos el estado vacío
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

    // 💡 3. Devolvemos los datos Y el token de la siguiente página de Google
    res.json({
        data: filtered,
        nextGoogleToken: googleData.nextToken || null
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
  
  // 💡 Lógica de paginación
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

    // 💡 Añadimos limit y offset al final
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

// --- Auxiliar Google ---
async function fetchFromGoogle(lat, lon, radius, category, pageToken = null) {
  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const queryText = CATEGORY_QUERIES[category] || CATEGORY_QUERIES['All'];

    const requestBody = {
      textQuery: queryText,
      maxResultCount: 20,
      locationBias: {
        circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: radius }
      }
    };

    // 💡 Si tenemos un token de Google de la página anterior, lo usamos
    if (pageToken) {
        requestBody.pageToken = pageToken;
    }

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      // 💡 Agregamos nextPageToken al FieldMask
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary,places.types,nextPageToken' 
    };

    const response = await axios.post(url, requestBody, { headers });
    const places = response.data.places || [];
    const nextToken = response.data.nextPageToken || null; // 💡 Capturamos el token

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

    // 💡 Devolvemos los lugares Y el token
    return {
        places: enrichedData.filter(item => item !== null),
        nextToken: nextToken
    };

  } catch (err) {
    console.error("🔥 ERROR GOOGLE API:", err.response?.data || err.message);
    return { places: [], nextToken: null };
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
export const getWikiFullDetails = async (req, res) => {
    const { title } = req.query;
    
    if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });
    
    try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|info&exintro=1&explaintext=1&inprop=url&generator=search&gsrsearch=${encodeURIComponent(title)}&gsrlimit=1&origin=*`;
        const response = await axios.get(url, WIKI_OPTS);
        const pages = response.data?.query?.pages;
        
        if (!pages) return res.status(404).json({ error: "No encontrado" });
        
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];

        res.json({ 
            full_description: pageData.extract,
            wiki_url: pageData.fullurl          
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