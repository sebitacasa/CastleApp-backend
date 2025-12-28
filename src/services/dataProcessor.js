import db from '../config/db.js';
import * as api from './externalApis.js'; 

// Función auxiliar para verificar si el título de Wiki es relevante
// Evita que "Hallstatt Museum" acepte el artículo de "Hallstatt" (Pueblo)
function isRelevante(osmName, wikiTitle) {
    if (!osmName || !wikiTitle) return false;
    const n = osmName.toLowerCase();
    const t = wikiTitle.toLowerCase();

    // Si el nombre de OSM tiene palabras clave específicas, el título de Wiki DEBE tenerlas también
    const keywords = ['museum', 'museo', 'castle', 'schloss', 'burg', 'festung', 'church', 'kirche', 'ruin'];
    
    for (let word of keywords) {
        // Si el lugar se llama "Museo X" pero el artículo Wiki es solo "X" (sin la palabra museo), lo rechazamos
        if (n.includes(word) && !t.includes(word)) {
            return false; 
        }
    }
    return true;
}

export const processImagesInBatches = async (elements) => {
    if (!elements || elements.length === 0) return;
    const BATCH_SIZE = 5; 
    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
        const batch = elements.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
            try {
                if (!item.images || item.images.length === 0 || item.images[0] === null) {
                    const name = item.name || item.tags?.['name:en'] || item.tags?.name; 
                    const lat = item.latitude || item.lat;
                    const lon = item.longitude || item.lon;

                    if (name) {
                        let imageList = [];
                        let finalDesc = null;
                        
                        // -----------------------------------------------------------
                        // 🔥 ESTRATEGIA REFINADA ANTI-DUPLICADOS 🔥
                        // -----------------------------------------------------------

                        // 1. Wikipedia por NOMBRE (Prioridad Máxima)
                        let wikiData = await api.getWikipediaDataByName(name);

                        // 2. Wikimedia Commons (Prioridad Media - FOTOS ESPECÍFICAS)
                        // Subimos Commons ANTES que el GPS. Es mejor tener una foto correcta de Commons
                        // que una foto incorrecta del pueblo vecino por GPS.
                        if (!wikiData?.hasData) {
                             const gallery = await api.getCommonsImages(name);
                             if (gallery.length > 0) imageList.push(...gallery);
                        }

                        // 3. Wikipedia por GPS (Prioridad Baja - Solo si falla todo lo demás)
                        // Y con filtro de relevancia para evitar que el Museo tome la foto del Pueblo
                        if ((!wikiData?.hasData && imageList.length === 0) && lat && lon) {
                             const gpsData = await api.getWikipediaDataByCoords(lat, lon);
                             // VALIDACIÓN: ¿El título encontrado se parece al nombre del lugar?
                             if (gpsData?.hasData && isRelevante(name, gpsData.title)) {
                                 wikiData = gpsData;
                             }
                        }

                        // Procesar datos de Wiki si encontramos algo válido
                        if (wikiData?.hasData) {
                            if (wikiData.imageUrl) imageList.unshift(wikiData.imageUrl); // Poner al principio
                            finalDesc = wikiData.description;
                        }

                        // 4. Mapillary (Último recurso absoluto)
                        if (imageList.length === 0 && lat && lon) {
                            const streetPhoto = await api.getMapillaryImage(lat, lon);
                            if (streetPhoto) imageList.push(streetPhoto);
                        }

                        if (imageList.length > 0 || finalDesc) {
                            const postgresArray = `{${[...new Set(imageList)].map(url => `"${url}"`).join(',')}}`;
                            const mainImage = imageList[0] || null;
                            
                            await db.raw(`UPDATE historical_locations SET images = ?, image_url = ?, description = COALESCE(?, description) WHERE name = ?`, [postgresArray, mainImage, finalDesc || "Información histórica no disponible.", name]);
                            console.log(`📸 Foto actualizada: ${name} (Fuente: ${wikiData?.hasData ? 'Wiki' : 'Commons/Otros'})`);
                        }
                    }
                }
            } catch (err) { /* Silent fail */ }
        }));
        await new Promise(r => setTimeout(r, 200));
    }
};

// Archivo: src/services/dataProcessor.js

// ... (El resto del código de processImagesInBatches queda igual) ...

// =====================================================================
// 3. EL PORTERO (CLASIFICADOR DETALLADO)
// =====================================================================
export async function insertElementsToDB(elements, locationLabel = 'Unknown') {
    const insertPromises = elements.map(async (item) => {
        const t = item.tags || {};
        const name = t['name:en'] || t.name || t['name:es']; 
        
        // 1. Si no tiene nombre, SOLO lo guardamos si es un tipo específico muy relevante
        // (A veces las placas no tienen 'name' pero tienen 'inscription', pero por ahora exigimos name)
        if (!name) return null;

        // 2. Filtro de BASURA REAL (Transporte, tiendas, etc)
        if (
            t.railway || t.public_transport || t.highway === 'bus_stop' || 
            t.amenity === 'bus_station' || t.amenity === 'taxi' || 
            t.amenity === 'ferry_terminal' || t.amenity === 'bicycle_rental' ||
            name.toLowerCase().includes('subte') || 
            name.toLowerCase().includes('estación') ||
            name.toLowerCase().includes('station') || 
            name.toLowerCase().includes('parada') ||
            name.toLowerCase().includes('terminal')
        ) {
            return null; 
        }

        const iLat = item.lat || item.center?.lat;
        const iLon = item.lon || item.center?.lon;
        
        // 3. CLASIFICACIÓN DETALLADA
        let cat = 'Others';

        // Prioridad Alta: Tipos específicos solicitados
        if (t['memorial:type'] === 'plaque' || t.historic === 'plaque') cat = 'Plaques';
        else if (t['memorial:type'] === 'bust') cat = 'Busts';
        else if (t['memorial:type'] === 'stolperstein') cat = 'Stolperstein';
        else if (t['memorial:type'] === 'bench') cat = 'Benches';
        
        // Prioridad Media: Estructuras grandes
        else if (t.historic === 'ruins') cat = 'Ruins';
        else if (t.tourism === 'museum') cat = 'Museums';
        else if (['castle', 'fortress', 'citywalls', 'manor', 'palace', 'fort'].includes(t.historic)) cat = 'Castles';
        else if (t.historic === 'monument' || t.historic === 'memorial') cat = 'Monuments';
        else if (t.historic === 'building' || t.historic === 'archaeological_site') cat = 'Historic Site';
        else if (t.tourism === 'attraction' || t.tourism === 'viewpoint') cat = 'Historic Site';
        else if (t.tourism === 'artwork') cat = 'Art'; 

        let finalAddress = locationLabel;
        const city = t['addr:city'] || t['addr:town'] || t['addr:village'];
        const street = t['addr:street'];
        if (city) finalAddress = street ? `${street}, ${city}` : city;
        const safeAddress = finalAddress.length > 90 ? finalAddress.substring(0, 90) + '...' : finalAddress;
        
        return db.raw(`INSERT INTO historical_locations (name, category, description, country, geom) VALUES (?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ON CONFLICT (name) DO NOTHING`, [name, cat, 'Discovered via exploration.', safeAddress, iLon, iLat]);
    });
    await Promise.all(insertPromises);
}