import axios from 'axios';

// 🔑 ASEGÚRATE DE QUE ESTA CLAVE SEA VÁLIDA Y TENGA "PLACES API (NEW)" HABILITADA
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'PON_TU_API_KEY_AQUI'; 

export const getGoogleLocations = async (req, res) => {
    // 1. Recibimos parámetros: pueden ser coordenadas O texto
    const { lat, lon, q, search } = req.query;
    const textQuery = q || search;

    // Validación básica: Necesitamos ALGO (coordenadas o texto)
    if ((!lat || !lon) && !textQuery) {
        return res.status(400).json({ error: 'Faltan coordenadas (lat/lon) o búsqueda (q)' });
    }

    try {
        let url = '';
        let requestBody = {};

        // 2. Definimos qué tipos de lugares queremos (Filtro VIP)
        const includedTypes = [
            'museum', 'tourist_attraction', 'historical_landmark', 
            'church', 'place_of_worship', 'castle', 'art_gallery',
            'monument'
        ];

        // 3. ESTRATEGIA A: BÚSQUEDA POR RADAR (Tengo coordenadas)
        if (lat && lon) {
            url = 'https://places.googleapis.com/v1/places:searchNearby';
            requestBody = {
                includedTypes: includedTypes,
                maxResultCount: 20,
                locationRestriction: {
                    circle: {
                        center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
                        radius: 2500.0 // 2.5 km a la redonda
                    }
                }
            };
        } 
        // 4. ESTRATEGIA B: BÚSQUEDA POR TEXTO (Tengo nombre de ciudad)
        else if (textQuery) {
            url = 'https://places.googleapis.com/v1/places:searchText';
            // Truco: Le pedimos "Tourist attractions in [Ciudad]" para que traiga lista, no solo el centro
            const smartQuery = `Tourist attractions in ${textQuery}`;
            
            requestBody = {
                textQuery: smartQuery,
                maxResultCount: 20,
            };
        }

        // 5. Configuración de Headers (FieldMask ahorra dinero)
        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            // Solo pedimos lo necesario: ID, Nombre, Dirección, Ubicación, Fotos, Resumen
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary'
        };

        // 6. Hacemos la llamada a Google
        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

        // 7. Limpiamos y formateamos los datos para tu App
        const cleanData = googlePlaces.map(place => {
            // Construir URL de la foto si existe
            let imageUrl = null;
            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name; 
                // URL directa a la imagen
                imageUrl = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            return {
                id: place.id,
                name: place.displayName?.text,
                category: 'Tourist', // Google no da categoría fácil, ponemos genérica o analizamos 'types'
                description: place.editorialSummary?.text || place.formattedAddress || "Popular location.",
                country: place.formattedAddress, // Usamos la dirección como subtítulo
                image_url: imageUrl,
                latitude: place.location?.latitude,
                longitude: place.location?.longitude
            };
        });

        console.log(`✅ Google encontró ${cleanData.length} lugares para: ${textQuery || (lat+','+lon)}`);
        
        // 8. Enviamos la respuesta
        res.json({ data: cleanData });

    } catch (error) {
        // Mejor manejo de errores para ver qué dice Google
        console.error("🔥 Error Google API:", error.response?.data || error.message);
        const googleError = error.response?.data?.error?.message || 'Error consultando Google API';
        res.status(500).json({ error: googleError });
    }
};