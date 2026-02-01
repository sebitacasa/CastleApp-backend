import axios from 'axios';

// Nota: Este controlador maneja búsquedas EXPLICITAS del usuario (ej: "Castillos en España").
// No toca la base de datos local. Sirve para la pantalla "SearchScreen".

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// 🏰 Categorías para enriquecer la búsqueda
const CATEGORY_QUERIES = {
    'All': "Top tourist attractions, historical sites, museums, and castles",
    'Castles': "Castles, palaces, fortresses, and citadels",
    'Ruins': "Ancient ruins, archaeological sites, and historic ruins",
    'Museums': "Museums, art galleries, and exhibitions",
    'Statues': "Statues, sculptures, and monuments",
    'Plaques': "Historical plaques, commemorative markers, and blue plaques",
    'Busts': "Statues, busts, and sculptures of people",
    'Stolperstein': "Stolpersteine memorials and stumbling stones",
    'Historic Site': "Historical landmarks, heritage sites, and old buildings",
    'Religious': "Churches, cathedrals, basilicas, monasteries, mosques, and temples",
    'Towers': "Observation towers, clock towers, and bell towers",
    'Tourist': "Tourist attractions, viewpoints, and points of interest",
    'Others': "Hidden gems, landmarks, and interesting places"
};

// ==========================================
// 🧹 HELPERS
// ==========================================

const isInvalidContext = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    // Filtramos palabras clave que indican que NO es un lugar turístico válido
    const trashKeywords = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document'];
    return trashKeywords.some(w => lowerText.includes(w));
};

// ==========================================
// 📚 WIKIPEDIA HELPER
// ==========================================
const getWikipediaSummary = async (lat, lon, name) => {
    try {
        // 1. Buscamos artículo por geolocalización (Radio 500m)
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=500&gslimit=1&format=json&origin=*`;
        
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'CastleApp/1.0' },
            timeout: 3000 // Timeout corto para no frenar la respuesta
        });

        const geoResult = searchRes.data.query?.geosearch?.[0];
        
        if (geoResult) {
            // 2. Si hay coincidencia, pedimos extracto e imagen
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
    } catch (error) {
        // Fallamos silenciosamente en Wiki para no romper la búsqueda principal
        return null;
    }
};

// ==========================================
// 🚀 CONTROLADOR PRINCIPAL (BÚSQUEDA EXTERNA)
// ==========================================
export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search; // Puede venir como 'q' o 'search'
    const selectedCategory = category || 'All';

    // Validación
    if ((!lat || !lon) && !textQuery) {
        return res.status(400).json({ error: 'Faltan datos de ubicación o texto de búsqueda' });
    }

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        
        // Construimos la query (ej: "Castles in Paris")
        const categorySearchTerm = CATEGORY_QUERIES[selectedCategory] || CATEGORY_QUERIES['All'];
        let finalQuery = textQuery ? `${categorySearchTerm} in ${textQuery}` : categorySearchTerm;
        
        // Configuramos la petición a Google
        let requestBody = { 
            textQuery: finalQuery, 
            maxResultCount: 20 
        };

        // Si hay coordenadas, priorizamos resultados cercanos (Bias)
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

        // 1. Llamada a Google
        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

        // 2. Procesamiento y Enriquecimiento (Wiki)
        const enrichedData = await Promise.all(googlePlaces.map(async (place) => {
            const pLat = place.location?.latitude;
            const pLon = place.location?.longitude;
            const pName = place.displayName?.text;

            // Filtro basura
            if (isInvalidContext(pName)) return null;

            let finalDescription = place.editorialSummary?.text || place.formattedAddress || "Discovered via Google.";
            let finalImage = null;
            let wikiTitle = null;

            // Obtener imagen de Google
            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name;
                finalImage = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            // Intentar enriquecer con Wikipedia (si tenemos coordenadas)
            if (pLat && pLon) {
                const wikiData = await getWikipediaSummary(pLat, pLon, pName);
                if (wikiData) {
                    if (wikiData.description && wikiData.description.length > 50) {
                        finalDescription = wikiData.description; // Preferimos descripción de Wiki
                    }
                    if (!finalImage && wikiData.imageUrl) {
                        finalImage = wikiData.imageUrl; // Usamos foto Wiki si Google no tiene
                    }
                    wikiTitle = wikiData.title;
                }
            }

            return {
                // Datos para mostrar en SearchScreen
                id: place.id, 
                name: pName,
                category: selectedCategory,
                description: finalDescription,
                image_url: finalImage || 'https://via.placeholder.com/400x300?text=No+Image',
                latitude: pLat,
                longitude: pLon,
                
                // Datos para guardar en DB
                google_place_id: place.id,
                address: place.formattedAddress,
                wiki_title: wikiTitle,
                source: 'google' 
            };
        }));

        // 3. Limpiar nulos y responder
        const validResults = enrichedData.filter(item => item !== null);

        // Devolvemos { data: [...] } para compatibilidad con tu frontend
        res.json({ data: validResults });

    } catch (error) {
        console.error("🔥 Error Google Places:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error obteniendo lugares externos' });
    }
};

export const getLocations = async (req, res) => {
  const { lat, lon } = req.query;
  const googleRadius = 5000; // 5km a la redonda

  if (!lat || !lon) {
    return res.status(400).json({ error: "Faltan coordenadas (lat, lon)" });
  }

  try {
    // Ejecutamos las dos búsquedas al mismo tiempo (Paralelo)
    const [dbResults, googleResults] = await Promise.all([
      fetchFromDatabase(lat, lon),
      fetchFromGoogle(lat, lon, googleRadius)
    ]);

    // Unimos los resultados en una sola lista
    const combined = [...dbResults, ...googleResults];
    res.json(combined);

  } catch (error) {
    console.error("Error Híbrido:", error);
    res.status(500).json({ error: "Error obteniendo lugares" });
  }
};
export const getPendingLocations = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM historical_locations WHERE is_approved = FALSE ORDER BY id DESC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: e.message}); }
};

// B. Aprobar (Esta es la que te faltaba)
export const approveLocation = async (req, res) => {
    try {
        // Actualizamos la base de datos: is_approved = TRUE
        await pool.query('UPDATE historical_locations SET is_approved = TRUE WHERE id = $1', [req.params.id]);
        res.json({ message: "Lugar aprobado y visible en el mapa." });
    } catch (e) { 
        console.error("Error aprobando:", e);
        res.status(500).json({error: e.message}); 
    }
};

// C. Rechazar (Eliminar)
export const rejectLocation = async (req, res) => {
    try {
        await pool.query('DELETE FROM historical_locations WHERE id = $1', [req.params.id]);
        res.json({ message: "Lugar rechazado y eliminado." });
    } catch (e) { 
        console.error("Error rechazando:", e);
        res.status(500).json({error: e.message}); 
    }
};

// ==========================================
// 📥 2. SUGERIR (SUBIR LUGAR)
// ==========================================
export const suggestLocation = async (req, res) => {
  // 1. Recibimos los datos que envía el Frontend
  const { 
    name, 
    description, 
    latitude, 
    longitude, 
    image_url, 
    user_id, 
    google_place_id 
  } = req.body;
  
  try {
    // 2. VALIDACIÓN BÁSICA
    // Un lugar debe tener al menos nombre y ubicación.
    if (!name || !latitude || !longitude) {
        return res.status(400).json({ error: "Datos incompletos: Nombre y coordenadas requeridos." });
    }

    // 3. DETECTOR DE DUPLICADOS (Anti-Spam)
    // Si viene con ID de Google, verificamos si ya lo tenemos en la DB.
    if (google_place_id) {
       const check = await pool.query(
         'SELECT id FROM historical_locations WHERE google_place_id = $1', 
         [google_place_id]
       );
       
       if (check.rows.length > 0) {
         // Si ya existe, devolvemos error 400 para avisar al usuario
         return res.status(400).json({ error: "¡Este lugar ya ha sido registrado por otro explorador!" });
       }
    }

    // 4. INSERTAR EN BASE DE DATOS
    // Nota importante: is_approved = FALSE
    // Esto significa que el lugar se guarda, pero NO aparece en el mapa público
    // hasta que tú (Admin) lo apruebes.
    const query = `
      INSERT INTO historical_locations 
      (name, description, latitude, longitude, image_url, created_by_user_id, is_approved, google_place_id) 
      VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7) 
      RETURNING *
    `;

    const values = [
      name, 
      description || "Sin descripción", // Fallback si no hay descripción
      latitude, 
      longitude, 
      image_url, 
      user_id || null, // Puede ser null si es anónimo
      google_place_id
    ];

    const newLoc = await pool.query(query, values);
    
    // 5. RESPUESTA DE ÉXITO
    res.json({ 
      message: "¡Hallazgo enviado a revisión! Gracias por contribuir.", 
      location: newLoc.rows[0] 
    });

  } catch (err) {
    console.error("Error al guardar sugerencia:", err);
    res.status(500).json({ error: "Error interno al guardar el lugar." });
  }
};

// ==========================================
// 📖 ENDPOINT: READ MORE (Detalle Completo)
// ==========================================
export const getWikiFullDetails = async (req, res) => {
    const { title } = req.query;
    if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });

    try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(title)}&format=json&origin=*`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'CastleApp/1.0' } });
        
        const pages = response.data.query.pages;
        const pageId = Object.keys(pages)[0];
        
        if (pageId === "-1") return res.status(404).json({ error: "Artículo no encontrado" });

        res.json({ full_description: pages[pageId].extract || "No details found." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};