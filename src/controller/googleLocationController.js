import axios from 'axios';
import db from '../config/db.js'; // Si quieres guardar caché temporal

const GOOGLE_API_KEY = 'TU_CLAVE_DE_GOOGLE_AQUI'; // 🔑 Poner en .env

export const getGoogleLocations = async (req, res) => {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) return res.status(400).json({ error: 'Faltan coordenadas' });

    try {
        // 1. URL de la API "New" de Google Places
        const url = 'https://places.googleapis.com/v1/places:searchNearby';

        // 2. Filtros: ¿Qué queremos traer?
        const requestBody = {
            includedTypes: [
                'museum', 'tourist_attraction', 'historical_landmark', 
                'church', 'place_of_worship', 'castle', 'art_gallery'
            ],
            maxResultCount: 20, // Traer 20 lugares TOP
            locationRestriction: {
                circle: {
                    center: { latitude: parseFloat(lat), longitude: parseFloat(lon) },
                    radius: 2000.0 // 2 km a la redonda
                }
            }
        };

        // 3. FieldMask: IMPORTANTE para ahorrar dinero. Solo pedimos lo que usamos.
        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.photos,places.editorialSummary,places.id'
        };

        // 4. Hacemos la petición
        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces = response.data.places || [];

        // 5. Mapeamos los datos para tu App
        const cleanData = googlePlaces.map(place => {
            // Construir URL de la foto si existe
            let imageUrl = null;
            if (place.photos && place.photos.length > 0) {
                const photoReference = place.photos[0].name; // formato: places/PLACE_ID/photos/PHOTO_ID
                // URL lista para usar en el frontend
                imageUrl = `https://places.googleapis.com/v1/${photoReference}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`;
            }

            return {
                id: place.id, // ID de Google
                name: place.displayName?.text,
                category: 'Tourist', // Google ya filtra lo bueno
                description: place.editorialSummary?.text || "Popular location discovered via Google.",
                country: place.formattedAddress,
                image_url: imageUrl, // URL directa a la foto de Google
                latitude: place.location.latitude,
                longitude: place.location.longitude
            };
        });

        console.log(`✅ Google encontró ${cleanData.length} lugares VIP.`);
        
        // 6. Enviamos al Frontend
        res.json({ data: cleanData });

    } catch (error) {
        console.error("🔥 Error Google API:", error.response?.data || error.message);
        res.status(500).json({ error: 'Error consultando Google' });
    }
};