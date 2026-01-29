import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'TU_API_KEY_AQUI'; 

// 📖 DICCIONARIO DE TRADUCCIÓN (Tus Categorías -> Búsqueda Google)
const CATEGORY_QUERIES = {
    'All': "Top tourist attractions, historical sites, museums, and castles",
    'Castles': "Castles, palaces, fortresses, and citadels",
    'Ruins': "Ancient ruins, archaeological sites, and historic ruins",
    'Museums': "Museums, art galleries, and exhibitions",
    'Statues': "Statues, sculptures, and monuments",
    'Plaques': "Historical plaques, commemorative markers, and blue plaques",
    'Busts': "Statues, busts, and sculptures of people", // Google no diferencia mucho, agrupamos
    'Stolperstein': "Stolpersteine memorials and stumbling stones", // Muy específico
    'Historic Site': "Historical landmarks, heritage sites, and old buildings",
    'Religious': "Churches, cathedrals, basilicas, monasteries, mosques, and temples",
    'Towers': "Observation towers, clock towers, and bell towers",
    'Tourist': "Tourist attractions, viewpoints, and points of interest",
    'Others': "Hidden gems, landmarks, and interesting places"
};

export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search, category } = req.query;
    const textQuery = q || search;
    const selectedCategory = category || 'All'; // Si no envían nada, usamos 'All'

    // Validación básica
    if ((!lat || !lon) && !textQuery) {
        return res.status(400).json({ error: 'Faltan datos de ubicación' });
    }

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        
        // 1. Buscamos la traducción en nuestro diccionario
        const categorySearchTerm = CATEGORY_QUERIES[selectedCategory] || CATEGORY_QUERIES['All'];

        // 2. Construimos la frase de búsqueda final
        let finalQuery = "";

        if (textQuery) {
            // CASO CIUDAD: "Castles in Salzburg"
            finalQuery = `${categorySearchTerm} in ${textQuery}`;
            console.log(`🔎 Buscando por Ciudad + Categoría: "${finalQuery}"`);
        } else {
            // CASO GPS: "Castles" (con sesgo de ubicación)
            finalQuery = categorySearchTerm;
            console.log(`📍 Buscando por GPS + Categoría: "${finalQuery}" cerca de ${lat},${lon}`);
        }

        let requestBody = {
            textQuery: finalQuery,
            maxResultCount: 20,
        };

        // 3. Aplicamos el sesgo de ubicación si es GPS
        if (lat && lon && !textQuery) {
            requestBody.locationBias = {
                circle: {
                    center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
                    radius: 15000.0 // 15 km
                }
            };
        }

        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary,places.types'
        };

        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

        // 4. Mapeo de datos (Igual que antes)
        const cleanData = googlePlaces.map(place => {
            let imageUrl = null;
            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name;
                imageUrl = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            return {
                id: place.id,
                name: place.displayName?.text,
                category: selectedCategory, // Le devolvemos la categoría que pidió para que el Frontend no se confunda
                description: place.editorialSummary?.text || place.formattedAddress || "Discovered via Google.",
                country: place.formattedAddress, 
                image_url: imageUrl,
                latitude: place.location?.latitude,
                longitude: place.location?.longitude
            };
        });

        console.log(`✅ Enviando ${cleanData.length} resultados de tipo "${selectedCategory}"`);
        res.json({ data: cleanData });

    } catch (error) {
        console.error("🔥 Error Google API:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error al filtrar lugares con Google' });
    }
};