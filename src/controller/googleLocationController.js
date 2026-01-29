import axios from 'axios';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'TU_API_KEY_AQUI'; 

export const getGoogleLocations = async (req, res) => {
    const { lat, lon, q, search } = req.query;
    const textQuery = q || search;

    // Validación: Necesitamos algo para trabajar
    if ((!lat || !lon) && !textQuery) {
        return res.status(400).json({ error: 'Faltan datos de ubicación' });
    }

    try {
        // 🔥 CAMBIO DE ESTRATEGIA: USAMOS SIEMPRE "SEARCH TEXT" (Es más inteligente)
        const url = 'https://places.googleapis.com/v1/places:searchText';
        
        let requestBody = {
            maxResultCount: 20,
            // Pedimos explícitamente "Mejores atracciones", Google entiende esto mejor que categorías sueltas
            textQuery: "Top tourist attractions, historical sites, and museums", 
        };

        if (textQuery) {
            // CASO 1: Búsqueda por Ciudad (Ej: "Viena")
            console.log(`🔎 Buscando ciudad: ${textQuery}`);
            requestBody.textQuery = `Tourist attractions in ${textQuery}`;
        } 
        else if (lat && lon) {
            // CASO 2: GPS (Tu ubicación)
            // Le damos un "Sesgo" (Bias) hacia tu ubicación, pero permitimos que busque un poco más lejos si es necesario
            console.log(`📍 Buscando alrededor de: ${lat}, ${lon}`);
            requestBody.locationBias = {
                circle: {
                    center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
                    radius: 15000.0 // 15 km de radio (Cubre Valentín Alsina -> Palermo/Centro)
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

        // Mapeo limpio para tu App
        const cleanData = googlePlaces.map(place => {
            let imageUrl = null;
            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name;
                imageUrl = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            return {
                id: place.id,
                name: place.displayName?.text,
                category: 'Tourist', // Podrías mejorar esto leyendo place.types si quieres
                description: place.editorialSummary?.text || place.formattedAddress || "Discover this amazing location.",
                country: place.formattedAddress, 
                image_url: imageUrl,
                latitude: place.location?.latitude,
                longitude: place.location?.longitude
            };
        });

        console.log(`✅ Resultados enviados: ${cleanData.length}`);
        res.json({ data: cleanData });

    } catch (error) {
        console.error("🔥 Error Google API:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error al conectar con Google Maps' });
    }
};