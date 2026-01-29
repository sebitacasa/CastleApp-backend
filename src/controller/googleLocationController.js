import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'TU_API_KEY_AQUI'; 

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
const areNamesSimilar = (name1, name2) => {
    if (!name1 || !name2) return false;
    const n1 = name1.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const n2 = name2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (n1.includes(n2) || n2.includes(n1)) return true;
    const words1 = n1.split(' ').filter(w => w.length >= 4);
    const words2 = n2.split(' ');
    return words1.some(w => words2.includes(w));
};

const isInvalidContext = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    const trashKeywords = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document'];
    return trashKeywords.some(w => lowerText.includes(w));
};

const isTransportContext = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (lower.includes('estacion linea') || lower.includes('metro station') || lower.includes('bus stop'));
};

// ==========================================
// 📚 WIKIPEDIA HELPER (SOLO RESUMEN)
// ==========================================
const getWikipediaSummary = async (lat, lon, name) => {
    try {
        // 1. Buscamos por coordenadas para obtener el título exacto
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=500&gslimit=1&format=json&origin=*`;
        
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'CastleApp/1.0' } // 👈 Vital para evitar el Error 500
        });

        const geoResult = searchRes.data.query?.geosearch[0];
        
        if (geoResult) {
            return {
                title: geoResult.title,
                // Puedes agregar más campos si los necesitas
            };
        }
        return null;
    } catch (error) {
        console.error("Error en Wiki Search:", error.message);
        return null;
    }
};

// ==========================================
// 🚀 CONTROLADOR PRINCIPAL (LISTA)
// ==========================================
export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    if ((!lat || !lon) && !textQuery) return res.status(400).json({ error: 'Faltan datos de ubicación' });

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

            let finalDescription = place.editorialSummary?.text || place.formattedAddress || "Discovered via Google.";
            let finalImage = null;
            let wikiTitle = null;

            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name;
                finalImage = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            if (pLat && pLon) {
                const wikiData = await getWikipediaSummary(pLat, pLon, pName);
                if (wikiData) {
                    if (wikiData.description && wikiData.description.length > 50) {
                        finalDescription = wikiData.description;
                    }
                    if (!finalImage && wikiData.imageUrl) {
                        finalImage = wikiData.imageUrl;
                    }
                    wikiTitle = wikiData.title;
                }
            }

            // 🔥 PERSISTENCIA EN DB: 
            // Si tenemos wikiTitle, intentamos actualizar el registro en la DB
            if (wikiTitle) {
                db('historical_locations')
                    .where('name', pName)
                    .update({ wiki_title: wikiTitle })
                    .catch(err => console.log(`Nota: No se pudo actualizar wiki_title para ${pName} (posiblemente no está en la DB todavía)`));
            }

            return {
                id: place.id,
                name: pName,
                category: selectedCategory,
                description: finalDescription,
                country: place.formattedAddress,
                image_url: finalImage,
                latitude: pLat,
                longitude: pLon,
                wiki_title: wikiTitle 
            };
        }));

        res.json({ data: enrichedData });

    } catch (error) {
        console.error("🔥 Error:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error obteniendo lugares' });
    }
};

// ==========================================
// 📖 NUEVO ENDPOINT: READ MORE (Detalle Completo)
// ==========================================
export const getWikiFullDetails = async (req, res) => {
    const { title } = req.query;

    if (!title) return res.status(400).json({ error: 'Faltan parámetros' });

    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query',
            format: 'json',
            prop: 'extracts',
            titles: title,
            explaintext: '1',
            origin: '*' // 👈 Agregamos esto para evitar problemas de CORS
        });

        const response = await axios.get(`${baseUrl}?${params.toString()}`, {
            headers: { 'User-Agent': 'CastleApp/1.0 (https://tu-web-o-email.com)' }, // 👈 User-Agent real
            timeout: 5000 
        });

        const pages = response.data?.query?.pages;
        if (!pages || pages["-1"]) { // 👈 "-1" significa que Wikipedia no encontró el título
            return res.status(404).json({ error: 'Artículo no encontrado en Wikipedia' });
        }

        const pageId = Object.keys(pages)[0];
        const fullText = pages[pageId].extract;

        res.json({ full_description: fullText });

    } catch (error) {
        console.error("🔥 Error detallado:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error al conectar con Wikipedia' });
    }
};