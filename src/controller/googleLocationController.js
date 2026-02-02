import axios from 'axios';
import db from '../config/db.js'; 

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// ==========================================
// 🧠 LÓGICA DE CLASIFICACIÓN (Mapeo Inteligente)
// ==========================================
const detectCategory = (googleTypes = [], name = "", description = "") => {
    const text = (name + " " + description).toLowerCase();
    const types = googleTypes.map(t => t.toLowerCase());

    // 1. Prioridad: Palabras clave en el Nombre (Para cosas muy específicas)
    if (text.includes("stolperstein")) return "Stolperstein";
    if (text.includes("plaque") || text.includes("blue plaque") || text.includes("marker")) return "Plaques";
    if (text.includes("bust of") || text.includes("busto")) return "Busts";
    if (text.includes("ruin") || text.includes("ruinas") || text.includes("remains")) return "Ruins";
    if (text.includes("tower") || text.includes("torre") || text.includes("glockenspiel")) return "Towers";

    // 2. Prioridad: Tipos oficiales de Google
    if (types.includes("castle") || types.includes("fortress") || types.includes("palace")) return "Castles";
    if (types.includes("museum") || types.includes("art_gallery")) return "Museums";
    if (types.includes("church") || types.includes("place_of_worship") || types.includes("synagogue") || types.includes("mosque") || types.includes("hindu_temple")) return "Religious";
    if (types.includes("monument") || types.includes("sculpture") || types.includes("statue")) return "Statues";
    if (types.includes("historical_landmark") || types.includes("historic_site")) return "Historic Site";
    
    // 3. Categorías generales
    if (types.includes("tourist_attraction") || types.includes("point_of_interest") || types.includes("park") || types.includes("square")) return "Tourist";

    // 4. Default
    return "Others";
};

// ==========================================
// 🏰 DICCIONARIO DE BÚSQUEDA
// ==========================================
const CATEGORY_QUERIES = {
    'All': "Top tourist attractions, historical sites, museums, and castles",
    'Castles': "Castles, palaces, fortresses, and citadels",
    'Ruins': "Ancient ruins, archaeological sites, and historic ruins",
    'Museums': "Museums, art galleries, and exhibitions",
    'Statues': "Statues, sculptures, and monuments",
    'Plaques': "Historical plaques, commemorative markers, and blue plaques",
    'Busts': "Busts, sculptures of heads, historical busts",
    'Stolperstein': "Stolperstein, stumbling stones, memorial stones",
    'Historic Site': "Historical landmarks, heritage sites, ancient sites",
    'Religious': "Churches, cathedrals, temples, synagogues, mosques",
    'Towers': "Historic towers, clock towers, bell towers, observation towers",
    'Tourist': "Tourist attractions, town squares, parks, points of interest",
    'Others': "Hidden gems, landmarks, and interesting places"
};

// ... (Helpers previos: isInvalidContext, getWikipediaSummary se mantienen igual) ...
const isInvalidContext = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    const trashKeywords = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document', 'shop', 'store', 'hotel'];
    return trashKeywords.some(w => lowerText.includes(w));
};

const getWikipediaSummary = async (lat, lon, name) => {
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=500&gslimit=1&format=json&origin=*`;
        const searchRes = await axios.get(searchUrl, { timeout: 3000 });
        const geoResult = searchRes.data.query?.geosearch?.[0];
        
        if (geoResult) {
            const detailsUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro&explaintext&piprop=original&titles=${encodeURIComponent(geoResult.title)}&format=json&origin=*`;
            const detailsRes = await axios.get(detailsUrl, { timeout: 3000 });
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
  const { lat, lon } = req.query;
  const googleRadius = 10000; 

  if (!lat || !lon) return res.status(400).json({ error: "Faltan coordenadas" });

  try {
    const [dbResults, googleResults] = await Promise.all([
      fetchFromDatabase(lat, lon),
      fetchFromGoogle(lat, lon, googleRadius)
    ]);

    const combined = [...dbResults, ...googleResults];

    if (combined.length === 0) {
        return res.json([{
            id: 'debug-1',
            name: 'Sin resultados cercanos',
            description: 'Intenta buscar una ciudad manualmente o muévete a otra zona.',
            latitude: parseFloat(lat),
            longitude: parseFloat(lon),
            image_url: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5',
            category: 'Others', // Default
            source: 'db',
            country: 'Tu Ubicación'
        }]);
    }
    res.json(combined);
  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error interno" });
  }
};

// --- Auxiliar DB ---
async function fetchFromDatabase(lat, lon) {
  try {
    const query = `SELECT *, (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) AS distance FROM historical_locations WHERE is_approved = TRUE ORDER BY distance ASC LIMIT 20`;
    const r = await db.raw(query, [lat, lon, lat, lat, lon, lat]);
    
    return r.rows.map(row => ({
      ...row, 
      id: row.id.toString(), 
      latitude: row.lat, 
      longitude: row.lon, 
      source: 'db', 
      is_yours: true,
      country: 'Community',
      // Si no guardaste categoría en DB, inferimos por nombre o ponemos 'Others'
      category: detectCategory([], row.name, row.description) 
    }));
  } catch (err) { return []; }
}

// --- Auxiliar Google ---
async function fetchFromGoogle(lat, lon, radius) {
  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';
    
    // 👇 Buscamos de todo para luego clasificar
    const requestBody = {
      textQuery: "tourist attractions, historical landmarks, museums, castles, parks, monuments, squares, church, towers, ruins, memorial",
      maxResultCount: 20,
      locationBias: {
        circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: radius }
      }
    };

    // 👇 IMPORTANTE: Pedimos 'places.types' a Google
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

        // 👇 AQUI CLASIFICAMOS EL LUGAR
        const category = detectCategory(p.types, pName, finalDesc);

        return {
            id: p.id,
            name: pName,
            description: finalDesc,
            latitude: pLat,
            longitude: pLon,
            image_url: finalImage || 'https://via.placeholder.com/400x300',
            category: category, // ✅ Categoría asignada automáticamente
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

// ... (Resto de funciones: suggestLocation, getGoogleLocations, etc. se mantienen igual) ...
// Asegúrate de mantener las funciones de suggestLocation y demás que ya tienes.
export const suggestLocation = async (req, res) => {
    const { name, description, latitude, longitude, image_url, user_id, google_place_id } = req.body;
    try {
      if (google_place_id) {
         const check = await db.raw('SELECT id FROM historical_locations WHERE google_place_id = ?', [google_place_id]);
         if (check.rows.length > 0) return res.status(400).json({ error: "Ya registrado." });
      }
      const newLoc = await db.raw(
        `INSERT INTO historical_locations (name, description, lat, lon, image_url, created_by_user_id, is_approved, google_place_id) VALUES (?, ?, ?, ?, ?, ?, FALSE, ?) RETURNING *`,
        [name, description, latitude, longitude, image_url, user_id, google_place_id]
      );
      res.json({ message: "Recibido", location: newLoc.rows[0] });
    } catch (err) { res.status(500).json({ error: "Error guardar." }); }
  };
  
  export const getGoogleLocations = async (req, res) => {
      const { lat, lon, q, search, category } = req.query;
      const textQuery = q || search;
      const selectedCategory = category || 'All';
  
      if (!textQuery && !lat) return res.status(400).json({ error: 'Faltan datos' });
  
      try {
          const url = 'https://places.googleapis.com/v1/places:searchText';
          // Usamos el diccionario para mejorar la búsqueda
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
  
              // Usamos la misma función de clasificación aquí
              const cat = detectCategory(p.types, pName, finalDesc);
  
              return {
                  id: p.id, name: pName, description: finalDesc, latitude: pLat, longitude: pLon,
                  image_url: finalImage || 'https://via.placeholder.com/400x300',
                  category: cat, // ✅ Clasificación automática
                  source: 'google', google_place_id: p.id,
                  address: p.formattedAddress, country: shortAddress, wiki_title: wikiTitle
              };
          }));
  
          res.json({ data: enrichedData.filter(i => i !== null) });
  
      } catch (error) {
          res.status(500).json({ error: 'Error búsqueda externa' });
      }
  };
  
  export const getWikiFullDetails = async (req, res) => {
      const { title } = req.query;
      if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });
      try {
          const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(title)}&format=json&origin=*`;
          const response = await axios.get(url);
          const pages = response.data.query.pages;
          const pageId = Object.keys(pages)[0];
          if (pageId === "-1") return res.status(404).json({ error: "No encontrado" });
          res.json({ full_description: pages[pageId].extract });
      } catch (error) { res.status(500).json({ error: error.message }); }
  };
  
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