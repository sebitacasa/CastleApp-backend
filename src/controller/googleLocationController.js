import axios from 'axios';
// 👇 Importamos la conexión a la DB
import db from '../config/db.js'; 

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// ==========================================
// 🏰 DICCIONARIO DE BÚSQUEDA (Tus categorías)
// ==========================================
// Esto se usa cuando buscas por TEXTO (SearchScreen)
const CATEGORY_QUERIES = {
    'All': "Top tourist attractions, historical sites, museums, and castles",
    'Castles': "Castles, palaces, fortresses, and citadels",
    'Ruins': "Ancient ruins, archaeological sites, and historic ruins",
    'Museums': "Museums, art galleries, and exhibitions",
    'Statues': "Statues, sculptures, and monuments",
    'Plaques': "Historical plaques, commemorative markers, and blue plaques",
    'Others': "Hidden gems, landmarks, and interesting places"
};

// ==========================================
// 🧹 HELPERS
// ==========================================
const isInvalidContext = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    const trashKeywords = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document'];
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
                description: pageData.extract ? pageData.extract.substring(0, 250) + "..." : null,
                imageUrl: pageData.original?.source || null
            };
        }
        return null;
    } catch (error) { return null; }
};

// ==========================================
// 🗺️ 1. MAPA HÍBRIDO (GET /) - GPS
// ==========================================
export const getLocations = async (req, res) => {
  const { lat, lon } = req.query;
  
  // 🌍 RADIO AMPLIO: 10km para asegurar que agarre cosas si estás lejos del centro
  const googleRadius = 10000; 

  if (!lat || !lon) {
    return res.status(400).json({ error: "Faltan coordenadas (lat, lon)" });
  }

  try {
    const [dbResults, googleResults] = await Promise.all([
      fetchFromDatabase(lat, lon),
      fetchFromGoogle(lat, lon, googleRadius)
    ]);

    const combined = [...dbResults, ...googleResults];
    res.json(combined);

  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
};

// --- Auxiliar DB (Lee 'lat/lon', devuelve 'latitude/longitude') ---
async function fetchFromDatabase(lat, lon) {
  try {
    const query = `
      SELECT *, 
      (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) AS distance
      FROM historical_locations
      WHERE is_approved = TRUE
      ORDER BY distance ASC LIMIT 20
    `;
    const bindings = [lat, lon, lat, lat, lon, lat];
    const result = await db.raw(query, bindings);
    
    return result.rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      description: row.description,
      latitude: parseFloat(row.lat),
      longitude: parseFloat(row.lon),
      image_url: row.image_url,
      category: 'Community Discovery',
      source: 'db',      
      is_yours: true
    }));
  } catch (err) {
    console.error("Error DB:", err.message);
    return []; 
  }
}

// --- Auxiliar Google (GPS - Búsqueda por Cercanía) ---
async function fetchFromGoogle(lat, lon, radius) {
  try {
    // 🧠 TRUCO: En vez de 'searchNearby' (estricto), usamos 'searchText' (inteligente)
    // Esto hace que funcione EXACTAMENTE igual que tu buscador de ciudades.
    const url = 'https://places.googleapis.com/v1/places:searchText';
    
    const requestBody = {
      // Le pedimos una búsqueda amplia genérica
      textQuery: "tourist attractions, historical landmarks, museums, castles, parks, monuments",
      maxResultCount: 20,
      // Pero forzamos a que mire DONDE TÚ ESTÁS (Location Bias)
      locationBias: {
        circle: { 
            center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, 
            radius: radius // 10km
        }
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary'
    };

    const response = await axios.post(url, requestBody, { headers });
    const places = response.data.places || [];
    
    return places.map(p => ({
        id: p.id, 
        name: p.displayName?.text, 
        description: p.editorialSummary?.text || p.formattedAddress,
        latitude: p.location.latitude, 
        longitude: p.location.longitude,
        // Construimos la URL de la foto directamente
        image_url: p.photos?.[0] ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600` : null,
        category: 'Google Explorer', 
        source: 'google'
    }));

  } catch (err) {
    console.error("🔥 ERROR GOOGLE API:", err.response?.data || err.message);
    return [];
  }
}
// ==========================================
// 📥 2. SUGERIR / GUARDAR (POST /suggest)
// ==========================================
export const suggestLocation = async (req, res) => {
  const { name, description, latitude, longitude, image_url, user_id, google_place_id } = req.body;
  
  try {
    if (!name || !latitude || !longitude) {
        return res.status(400).json({ error: "Datos incompletos." });
    }

    if (google_place_id) {
       const check = await db.raw('SELECT id FROM historical_locations WHERE google_place_id = ?', [google_place_id]);
       if (check.rows.length > 0) return res.status(400).json({ error: "Este lugar ya fue registrado." });
    }

    // Guarda en columnas 'lat' y 'lon'
    const newLoc = await db.raw(
      `INSERT INTO historical_locations 
       (name, description, lat, lon, image_url, created_by_user_id, is_approved, google_place_id) 
       VALUES (?, ?, ?, ?, ?, ?, FALSE, ?) 
       RETURNING *`,
      [name, description, latitude, longitude, image_url, user_id, google_place_id]
    );
    
    res.json({ message: "Sugerencia recibida", location: newLoc.rows[0] });

  } catch (err) {
    console.error("Error suggest:", err);
    res.status(500).json({ error: "Error al guardar el lugar." });
  }
};

// ==========================================
// 🔭 3. BÚSQUEDA DE TEXTO (GET /external/search)
// ==========================================
export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    // Validación relajada: Si falta texto, usamos la categoría por defecto
    if (!textQuery && !lat) {
        return res.status(400).json({ error: 'Faltan datos de búsqueda' });
    }

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        
        // 👇 AQUI USAMOS TU DICCIONARIO
        const categorySearchTerm = CATEGORY_QUERIES[selectedCategory] || CATEGORY_QUERIES['All'];
        
        // Si el usuario escribió algo (ej: "Paris"), buscamos "Castles in Paris".
        // Si no escribió nada (búsqueda automática), buscamos solo la categoría.
        let finalQuery = textQuery 
            ? `${categorySearchTerm} in ${textQuery}` 
            : categorySearchTerm;
        
        let requestBody = { textQuery: finalQuery, maxResultCount: 20 };

        // Si tenemos coordenadas, le damos preferencia a lo cercano (Bias)
        if (lat && lon) {
            requestBody.locationBias = {
                circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: 20000.0 } // 20km bias
            };
        }

        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary'
        };

        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

        // Enriquecemos con Wikipedia
        const enrichedData = await Promise.all(googlePlaces.map(async (place) => {
            const pLat = place.location?.latitude;
            const pLon = place.location?.longitude;
            const pName = place.displayName?.text;

            if (isInvalidContext(pName)) return null;

            let finalDescription = place.editorialSummary?.text || place.formattedAddress;
            let finalImage = null;
            let wikiTitle = null;

            if (place.photos && place.photos.length > 0) {
                finalImage = `https://places.googleapis.com/v1/${place.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            if (pLat && pLon) {
                const wikiData = await getWikipediaSummary(pLat, pLon, pName);
                if (wikiData) {
                    if (wikiData.description && wikiData.description.length > 50) finalDescription = wikiData.description;
                    if (!finalImage && wikiData.imageUrl) finalImage = wikiData.imageUrl;
                    wikiTitle = wikiData.title;
                }
            }

            return {
                id: place.id,
                name: pName,
                category: selectedCategory,
                description: finalDescription,
                image_url: finalImage || 'https://via.placeholder.com/400x300',
                latitude: pLat,
                longitude: pLon,
                google_place_id: place.id,
                address: place.formattedAddress,
                wiki_title: wikiTitle,
                source: 'google'
            };
        }));

        const validResults = enrichedData.filter(item => item !== null);
        res.json({ data: validResults });

    } catch (error) {
        console.error("Error Text Search:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error búsqueda externa' });
    }
};

// ==========================================
// 📖 4. WIKIPEDIA DETALLE
// ==========================================
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
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ==========================================
// 🛡️ 5. ADMIN
// ==========================================
export const getPendingLocations = async (req, res) => {
    try {
        const result = await db.raw('SELECT * FROM historical_locations WHERE is_approved = FALSE ORDER BY id DESC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: e.message}); }
};

export const approveLocation = async (req, res) => {
    try {
        await db.raw('UPDATE historical_locations SET is_approved = TRUE WHERE id = ?', [req.params.id]);
        res.json({ message: "Aprobado" });
    } catch (e) { res.status(500).json({error: e.message}); }
};

export const rejectLocation = async (req, res) => {
    try {
        await db.raw('DELETE FROM historical_locations WHERE id = ?', [req.params.id]);
        res.json({ message: "Eliminado" });
    } catch (e) { res.status(500).json({error: e.message}); }
};