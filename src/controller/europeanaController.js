import db from '../config/db.js';
import axios from 'axios';
import { getExpandedSearchTerms } from '../utils/synonyms.js';

import { DENSE_CITIES, getBoundingBox } from '../utils/geoUtils.js';
import { 
    fetchOverpassData, 
    getNominatimData, 
    getReverseNominatim 
} from '../services/externalApis.js'; 
// Nota: processImagesInBatches e insertElementsToDB los definimos aquí mismo ahora
// para poder aplicar los filtros personalizados que pides.

// ==========================================
// 🚨 HELPER: DETECTOR DE TRANSPORTE
// ==========================================
const isTransportContext = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
        lower.includes('estacion linea') || 
        lower.includes('estación línea') ||
        lower.includes('station on line') || // Para el caso en inglés de tu foto
        lower.includes('metro station') ||
        lower.includes('subway station') ||
        lower.includes('estación de subte') ||
        lower.includes('estación de tren')
    );
};

// ==========================================
// 2. HELPERS DE WIKIPEDIA (Requeridos aquí para el Worker)
// ==========================================
async function getWikipediaData(lat, lon) {
    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'geosearch',
            ggscoord: `${lat}|${lon}`, ggsradius: '500', ggslimit: '1',
            prop: 'extracts|pageimages', exintro: '1', explaintext: '1', pithumbsize: '600'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 4000 });
        const pages = response.data?.query?.pages;
        if (!pages) return null;
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];
        return {
            hasData: true,
            title: pageData.title,
            description: pageData.extract ? pageData.extract.substring(0, 400) + "..." : null,
            imageUrl: pageData.thumbnail?.source || null
        };
    } catch (e) { return null; }
}

async function getWikipediaDataByName(name) {
    try {
        const baseUrl = 'https://es.wikipedia.org/w/api.php'; 
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'search',
            gsrsearch: name, gsrlimit: '1', 
            prop: 'extracts|pageimages', exintro: '1', explaintext: '1', pithumbsize: '600'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 4000 });
        const pages = response.data?.query?.pages;
        if (!pages) return null;
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];
        return {
            hasData: true,
            title: pageData.title,
            description: pageData.extract ? pageData.extract.substring(0, 400) + "..." : null,
            imageUrl: pageData.thumbnail?.source || null
        };
    } catch (e) { return null; }
}

async function getCommonsImages(locationName) {
    try {
        const baseUrl = 'https://commons.wikimedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'search',
            gsrsearch: locationName, gsrnamespace: '6', gsrlimit: '3', prop: 'imageinfo', iiprop: 'url', origin: '*'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 4000 });
        const pages = response.data?.query?.pages;
        if (!pages) return [];
        return Object.values(pages).map(p => p.imageinfo?.[0]?.url).filter(u => u); 
    } catch (e) { return []; }
}

async function getMapillaryImage(lat, lon) {
    try {
        const MAPILLARY_TOKEN = 'MLY|25296378576723082|c74a374cec37733c10c8879dd9878e67'; 
        const url = `https://graph.mapillary.com/images?access_token=${MAPILLARY_TOKEN}&fields=id,thumb_1024_url&is_pano=false&closeto=${lon},${lat}&radius=1000&limit=1`;
        const res = await axios.get(url, { timeout: 4000 });
        return res.data.data?.[0]?.thumb_1024_url || null;
    } catch (e) { return null; }
}

// ==========================================
// 3. WORKER DE FOTOS (Con filtro de descripción)
// ==========================================
const processImagesInBatches = async (elements) => {
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
                        
                        let wikiData = null;
                        if (lat && lon) wikiData = await getWikipediaData(lat, lon);

                        // 🔥 FILTRO: Si Wikipedia trajo datos de una estación de subte, los BORRAMOS
                        if (wikiData?.hasData && isTransportContext(wikiData.description)) {
                            console.log(`🚫 Descripción de transporte detectada y descartada para: ${name}`);
                            wikiData = null; // Anulamos los datos malos
                        }

                        if (!wikiData?.hasData || !wikiData?.imageUrl) {
                            const cleanName = name.replace(/The |El |La /g, ''); 
                            wikiData = await getWikipediaDataByName(cleanName);
                            
                            // 🔥 RE-CHECK: Verificamos también la búsqueda por nombre
                            if (wikiData?.hasData && isTransportContext(wikiData.description)) {
                                wikiData = null;
                            }
                        }

                        if (wikiData?.hasData) {
                            if (wikiData.imageUrl) imageList.push(wikiData.imageUrl);
                            finalDesc = wikiData.description;
                        }
                        
                        if (imageList.length === 0) {
                            const gallery = await getCommonsImages(name);
                            if (gallery.length > 0) imageList.push(...gallery);
                        }

                        if (imageList.length === 0 && lat && lon) {
                            const streetPhoto = await getMapillaryImage(lat, lon);
                            if (streetPhoto) imageList.push(streetPhoto);
                        }

                        if (imageList.length > 0 || finalDesc) {
                            const postgresArray = `{${[...new Set(imageList)].map(url => `"${url}"`).join(',')}}`;
                            const mainImage = imageList[0] || null;
                            
                            await db.raw(`UPDATE historical_locations SET images = ?, image_url = ?, description = COALESCE(?, description) WHERE name = ?`, [postgresArray, mainImage, finalDesc || "Información histórica no disponible.", name]);
                            console.log(`📸 Foto actualizada: ${name}`);
                        }
                    }
                }
            } catch (err) { /* Silent fail */ }
        }));
        await new Promise(r => setTimeout(r, 200));
    }
};

// ==========================================
// 4. EL PORTERO (Con filtro de nombre)
// ==========================================
async function insertElementsToDB(elements, locationLabel = 'Unknown') {
    const insertPromises = elements.map(async (item) => {
        const t = item.tags || {};
        const name = t['name:en'] || t.name || t['name:es']; 
        if (!name) return null;

        // 🔥 FILTRO DE NOMBRE: Si el lugar se llama "Estación Línea D", adiós.
        if (isTransportContext(name)) {
            return null;
        }

        if (
            t.railway || t.public_transport || t.highway === 'bus_stop' || 
            t.amenity === 'bus_station' || t.amenity === 'taxi' || 
            t.amenity === 'ferry_terminal' || t.amenity === 'bicycle_rental' ||
            name.toLowerCase().includes('subte') || name.toLowerCase().includes('estación') ||
            name.toLowerCase().includes('station') || name.toLowerCase().includes('parada') ||
            name.toLowerCase().includes('terminal')
        ) {
            return null; 
        }

        const iLat = item.lat || item.center?.lat;
        const iLon = item.lon || item.center?.lon;
        
        let cat = 'Others';
        if (t.historic === 'ruins') cat = 'Ruins';
        else if (t.tourism === 'museum') cat = 'Museums';
        else if (['castle', 'fortress', 'citywalls', 'manor', 'palace'].includes(t.historic)) cat = 'Castles';
        else if (t.historic === 'monument' || t.historic === 'memorial') cat = 'Monuments';
        else if (t.historic === 'building') cat = 'Historic Site';
        else if (t.tourism === 'attraction') cat = 'Historic Site';
        else if (t.tourism === 'artwork') cat = 'Monuments'; 

        let finalAddress = locationLabel;
        const city = t['addr:city'] || t['addr:town'] || t['addr:village'];
        const street = t['addr:street'];
        if (city) finalAddress = street ? `${street}, ${city}` : city;
        const safeAddress = finalAddress.length > 90 ? finalAddress.substring(0, 90) + '...' : finalAddress;
        
        return db.raw(`INSERT INTO historical_locations (name, category, description, country, geom) VALUES (?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ON CONFLICT (name) DO NOTHING`, [name, cat, 'Discovered via exploration.', safeAddress, iLon, iLat]);
    });
    await Promise.all(insertPromises);
}

// ==========================================
// 5. CONTROLADOR PRINCIPAL: GET LOCALIZACIONES
// ==========================================
export const getLocalizaciones = async (req, res) => {
    req.setTimeout(120000); 

    const search = req.query.q || req.query.search || "";
    const { category, lat, lon } = req.query; 
    const limit = parseInt(req.query.limit) || 50; 
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    try {
        let selectValues = [], whereValues = [], orderValues = [];
        let selectFields = `id, name, category, image_url, images, description, country, ST_X(geom) AS longitude, ST_Y(geom) AS latitude`;
        
        if (lat && lon) {
            selectFields += `, ST_Distance(geom::geography, ST_MakePoint(?, ?)::geography) as distance_meters`;
            selectValues.push(parseFloat(lon), parseFloat(lat)); 
        }

        let baseWhere = `FROM historical_locations WHERE 1=1`;
        
        // --- RADIO SQL ---
        if (lat && lon && !search) {
            baseWhere += ` AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 80000)`; 
            whereValues.push(parseFloat(lon), parseFloat(lat));
        }

        const searchTerms = getExpandedSearchTerms(search); 
        if (searchTerms.length > 0) {
            const orConditions = [];
            searchTerms.forEach(term => {
                orConditions.push(`(name ILIKE ? OR country ILIKE ?)`);
                whereValues.push(`%${term}%`); whereValues.push(`%${term}%`);
            });
            baseWhere += ` AND (${orConditions.join(' OR ')})`;
        }
        
        if (category && category !== 'All') {
            baseWhere += ` AND category = ?`;
            whereValues.push(category);
        }

        let orderByClause = `ORDER BY id DESC`; 
        if (lat && lon && !search) {
            orderByClause = `ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)`;
            orderValues.push(parseFloat(lon), parseFloat(lat)); 
        }

        const finalQuery = `SELECT ${selectFields} ${baseWhere} ${orderByClause} LIMIT ? OFFSET ?`;
        const allValues = [...selectValues, ...whereValues, ...orderValues, limit, offset];
        
        const initialResult = await db.raw(finalQuery, allValues);
        let dataToSend = initialResult.rows;

        // --- CASO A: BÚSQUEDA POR TEXTO ---
        if (page === 1 && dataToSend.length === 0 && search.length > 3) {
            console.log(`🔎 [Caso A] Buscando Texto Global: "${search}"`);
            const nominatimInfo = await getNominatimData(search);
            
            if (nominatimInfo && nominatimInfo.type !== 'country') {
                const isArea = ['city','administrative','county','state','town','village','region', 'municipality'].includes(nominatimInfo.type) || ['place','boundary'].includes(nominatimInfo.class);

                if (isArea) {
                    const displayNameLower = nominatimInfo.displayName.toLowerCase();
                    const isDenseCity = DENSE_CITIES.some(city => displayNameLower.includes(city));
                    
                    let bbox;
                    if (nominatimInfo.bbox && !isDenseCity) bbox = nominatimInfo.bbox;
                    else bbox = getBoundingBox(nominatimInfo.lat, nominatimInfo.lon, isDenseCity ? 13.5 : 12);
                    
                    const maxResults = 200;
                    console.log(`🌍 Explorando (Overpass) | Límite: ${maxResults}`);

                    const query = `
                        [out:json][timeout:60];
                        (
                            nwr["historic"~"castle|fortress|ruins|monument|memorial|manor|building|archaeological_site|battlefield"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                            nwr["tourism"~"museum|artwork|viewpoint|attraction|gallery"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                        );
                        out center ${maxResults};
                    `;

                    const elements = await fetchOverpassData(query, 90000);

                    if (elements.length > 0) {
                        await insertElementsToDB(elements, nominatimInfo.displayName);
                        const tempResult = await db.raw(finalQuery, allValues);
                        const itemsToProcess = tempResult.rows;
                        if (itemsToProcess.length > 0) {
                            await Promise.race([
                                processImagesInBatches(itemsToProcess.slice(0, 1)), 
                                new Promise(r => setTimeout(r, 3000))
                            ]);
                            if (itemsToProcess.length > 1) processImagesInBatches(itemsToProcess.slice(1)).catch(console.error);
                        }
                        const finalResult = await db.raw(finalQuery, allValues);
                        dataToSend = finalResult.rows;
                    }
                }
            }
        }

        // --- CASO B: BÚSQUEDA POR COORDENADAS ---
        else if (page === 1 && lat && lon && !search) { 
            const nearbyItems = dataToSend.filter(i => i.distance_meters && i.distance_meters < 3000);
            
            if (dataToSend.length < 10 || nearbyItems.length < 3) {
                console.log(`📍 [Caso B] Zona GPS vacía. Buscando...`);
                
                const areaName = await getReverseNominatim(lat, lon);
                const bbox = getBoundingBox(parseFloat(lat), parseFloat(lon), 12);
                const maxResults = 200; 
                
                const query = `
                    [out:json][timeout:60];
                    (
                        nwr["historic"~"castle|fortress|ruins|monument|memorial|manor|building|archaeological_site|battlefield"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                        nwr["tourism"~"museum|artwork|viewpoint|attraction|gallery"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    );
                    out center ${maxResults}; 
                `;

                const elements = await fetchOverpassData(query, 90000);

                if (elements.length > 0) {
                    await insertElementsToDB(elements, areaName);
                    const tempResult = await db.raw(finalQuery, allValues);
                    const itemsToProcess = tempResult.rows;
                    if (itemsToProcess.length > 0) {
                        const priorityBatch = itemsToProcess.slice(0, 1);
                        const backgroundBatch = itemsToProcess.slice(1);
                        await Promise.race([
                            processImagesInBatches(priorityBatch),
                            new Promise(resolve => setTimeout(resolve, 3000))
                        ]);
                        if (backgroundBatch.length > 0) {
                            processImagesInBatches(backgroundBatch).catch(console.error);
                        }
                    }
                    const finalResult = await db.raw(finalQuery, allValues);
                    dataToSend = finalResult.rows;
                }
            }
        }

        // RELLENO DE FOTOS
        const itemsSinFoto = dataToSend.filter(item => !item.images || item.images.length === 0);
        if (itemsSinFoto.length > 0) {
             const vipFix = itemsSinFoto.slice(0, 1);
             const bgFix = itemsSinFoto.slice(1);
             if (vipFix.length > 0) await processImagesInBatches(vipFix);
             if (bgFix.length > 0) processImagesInBatches(bgFix).catch(console.error);
             const finalRefresh = await db.raw(finalQuery, allValues);
             dataToSend = finalRefresh.rows;
        }

        console.log(`✅ Enviando ${dataToSend.length} resultados.`);
        res.json({ page, limit, data: dataToSend });

    } catch (error) {
        console.error("🔥 Error Controller:", error.message);
        if (!res.headersSent) res.status(500).json({ error: "Server Error" });
    }
};

export const getProxyImage = async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('Falta URL');
        const response = await axios({ url: decodeURIComponent(url), method: 'GET', responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        res.set('Content-Type', response.headers['content-type']);
        res.set('Cache-Control', 'public, max-age=86400');
        response.data.pipe(res);
    } catch (error) { if (!res.headersSent) res.status(404).end(); }
};