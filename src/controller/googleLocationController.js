import axios from 'axios';
// 👇 Importamos la conexión Knex
import db from '../config/db.js'; 

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// 🏰 Categorías para enriquecer la búsqueda de texto
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
// 🗺️ 1. MAPA HÍBRIDO (Feed Principal)
// ==========================================
export const getLocations = async (req, res) => {
  const { lat, lon } = req.query;
  const googleRadius = 5000; 

  if (!lat || !lon) {
    return res.status(400).json({ error: "Faltan coordenadas (lat, lon)" });
  }

  try {
    const [dbResults, googleResults] = await Promise.all([
      fetchFromDatabase(lat, lon),
      fetchFromGoogle(lat, lon, googleRadius)
    ]);

    // Combinamos DB + Google
    const combined = [...dbResults, ...googleResults];
    res.json(combined);

  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
};

// --- Auxiliar DB (Adaptado a columnas 'lat' y 'lon') ---
async function fetchFromDatabase(lat, lon) {
  try {
    // 👇 CAMBIO: Usamos 'lat' y 'lon' en la fórmula SQL porque así se llaman en tu DB
    const query = `
      SELECT *, 
      (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) AS distance
      FROM historical_locations
      WHERE is_approved = TRUE
      AND (6371 * acos(cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) + sin(radians(?)) * sin(radians(lat)))) < 50
      ORDER BY distance ASC LIMIT 20
    `;
    const bindings = [lat, lon, lat, lat, lon, lat];
    const result = await db.raw(query, bindings);
    
    // 👇 CAMBIO: Mapeamos row.lat -> latitude para que el Frontend lo entienda
    return result.rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      description: row.description,
      latitude: parseFloat(row.lat), // Leemos 'lat' de la DB
      longitude: parseFloat(row.lon), // Leemos 'lon' de la DB
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

// --- Auxiliar Google (Nearby) ---
async function fetchFromGoogle(lat, lon, radius) {
  try {
    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    const requestBody = {
      includedTypes: ["castle", "fortress", "historical_landmark", "museum", "ruins"],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: radius }
      }
    };
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary'
    };

    const response = await axios.post(url, requestBody, { headers });
    const places = response.data.places || [];

    return places.map(place => {
      let finalImage = null;
      if (place.photos && place.photos.length > 0) {
        const photoRef = place.photos[0].name;
        finalImage = `https://places.googleapis.com/v1/${photoRef}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600`;
      }
      return {
        id: place.id,
        name: place.displayName?.text,
        description: place.editorialSummary?.text || place.formattedAddress,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        image_url: finalImage || 'https://via.placeholder.com/400x300',
        category: 'Google Explorer',
        source: 'google',
        google_place_id: place.id
      };
    });
  } catch (err) {
    return [];
  }
}

// ==========================================
// 📥 2. SUGERIR / GUARDAR (Adaptado a 'lat' y 'lon')
// ==========================================
export const suggestLocation = async (req, res) => {
  const { name, description, latitude, longitude, image_url, user_id, google_place_id } = req.body;
  
  try {
    if (!name || !latitude || !longitude) {
        return res.status(400).json({ error: "Datos incompletos." });
    }

    // Validación duplicados
    if (google_place_id) {
       const check = await db.raw('SELECT id FROM historical_locations WHERE google_place_id = ?', [google_place_id]);
       if (check.rows.length > 0) return res.status(400).json({ error: "Este lugar ya fue registrado." });
    }

    // 👇 CAMBIO: Insertamos en las columnas 'lat' y 'lon'
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
// 🔭 3. BÚSQUEDA DE TEXTO (Google + Wiki)
// ==========================================
export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    if ((!lat || !lon) && !textQuery) {
        return res.status(400).json({ error: 'Faltan datos de ubicación o texto' });
    }

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const categorySearchTerm = CATEGORY_QUERIES[selectedCategory] || CATEGORY_QUERIES['All'];
        let finalQuery = textQuery ? `${categorySearchTerm} in ${textQuery}` : categorySearchTerm;
        
        let requestBody = { textQuery: finalQuery, maxResultCount: 20 };

        if (lat && lon && !textQuery) {
            requestBody.locationBias = {
                circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: 15000.0 }
            };
        }

        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary'
        };

        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

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
// 🛡️ 5. ADMIN (Knex)
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