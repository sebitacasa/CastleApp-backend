import axios from 'axios';
// Nota: No importamos 'pool' aquí porque la búsqueda externa 
// no toca la base de datos hasta que el usuario decida "Sugerir" el lugar.

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'TU_API_KEY_AQUI'; 

// 🏰 Categorías (Optimizadas para hallazgos históricos)
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
    // Filtramos cosas comerciales o irrelevantes
    const trashKeywords = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document'];
    return trashKeywords.some(w => lowerText.includes(w));
};

// ==========================================
// 📚 WIKIPEDIA HELPER
// ==========================================
const getWikipediaSummary = async (lat, lon, name) => {
    try {
        // 1. Buscamos artículo por geolocalización
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=500&gslimit=1&format=json&origin=*`;
        
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'CastleApp/1.0' }
        });

        const geoResult = searchRes.data.query?.geosearch?.[0];
        
        if (geoResult) {
            // 2. Si hay match, pedimos extracto e imagen
            const detailsUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro&explaintext&piprop=original&titles=${encodeURIComponent(geoResult.title)}&format=json&origin=*`;
            const detailsRes = await axios.get(detailsUrl);
            
            const pages = detailsRes.data.query.pages;
            const pageId = Object.keys(pages)[0];
            const pageData = pages[pageId];

            return {
                title: geoResult.title,
                description: pageData.extract ? pageData.extract.substring(0, 200) + "..." : null,
                imageUrl: pageData.original?.source || null
            };
        }
        return null;
    } catch (error) {
        console.error("Error en Wiki Search:", error.message);
        return null;
    }
};

// ==========================================
// 🚀 CONTROLADOR PRINCIPAL (BÚSQUEDA EXTERNA)
// ==========================================
export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    // Validación
    if ((!lat || !lon) && !textQuery) {
        return res.status(400).json({ error: 'Faltan datos de ubicación o texto de búsqueda' });
    }

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const categorySearchTerm = CATEGORY_QUERIES[selectedCategory] || CATEGORY_QUERIES['All'];
        
        let finalQuery = textQuery ? `${categorySearchTerm} in ${textQuery}` : categorySearchTerm;
        let requestBody = { textQuery: finalQuery, maxResultCount: 20 };

        // Priorizar cercanía si hay coordenadas (Bias)
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

        // Procesamiento en paralelo (Enriquecer datos)
        const enrichedData = await Promise.all(googlePlaces.map(async (place) => {
            const pLat = place.location?.latitude;
            const pLon = place.location?.longitude;
            const pName = place.displayName?.text;

            // Filtro anti-basura
            if (isInvalidContext(pName)) return null;

            let finalDescription = place.editorialSummary?.text || place.formattedAddress || "Discovered via Google.";
            let finalImage = null;
            let wikiTitle = null;

            // Intentar obtener imagen de Google
            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name;
                finalImage = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            // Intentar enriquecer con Wikipedia
            if (pLat && pLon) {
                const wikiData = await getWikipediaSummary(pLat, pLon, pName);
                if (wikiData) {
                    if (wikiData.description && wikiData.description.length > 50) {
                        finalDescription = wikiData.description;
                    }
                    // Si Google no tiene foto pero Wiki sí, usamos Wiki
                    if (!finalImage && wikiData.imageUrl) {
                        finalImage = wikiData.imageUrl;
                    }
                    wikiTitle = wikiData.title;
                }
            }

            return {
                // --- DATOS VISUALES (Para mostrar en la lista) ---
                id: place.id, // ID temporal (es el de Google)
                name: pName,
                category: selectedCategory,
                description: finalDescription,
                image_url: finalImage || 'https://via.placeholder.com/400x300?text=No+Image',
                latitude: pLat,
                longitude: pLon,
                
                // --- DATOS TÉCNICOS (Para cuando el usuario haga "Guardar") ---
                google_place_id: place.id,  // Vital para evitar duplicados en tu DB
                address: place.formattedAddress,
                wiki_title: wikiTitle,
                source: 'google' // Bandera para que el Frontend sepa mostrar el botón "Sugerir"
            };
        }));

        // Eliminar nulos
        const validResults = enrichedData.filter(item => item !== null);

        res.json({ data: validResults });

    } catch (error) {
        console.error("🔥 Error Google Places:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error obteniendo lugares externos' });
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