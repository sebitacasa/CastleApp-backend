import db from '../config/db.js';
import { getExpandedSearchTerms } from '../utils/synonyms.js';
import axios from 'axios';

// ==========================================
// 1. SERVER MANAGEMENT (RESILIENT MODE)
// ==========================================
const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
];

const fetchOverpassData = async (query, timeoutMs = 45000) => {
    let servers = [...OVERPASS_SERVERS].sort(() => 0.5 - Math.random());

    for (const serverUrl of servers) {
        console.log(`📡 Testing Overpass: ${serverUrl}...`);
        try {
            const osmRes = await axios.post(serverUrl, `data=${encodeURIComponent(query)}`, { 
                timeout: timeoutMs, 
                headers: { 'User-Agent': 'CastleApp/1.0' } 
            });
            if (osmRes.data && osmRes.data.elements) return osmRes.data.elements;
        } catch (e) {
            console.warn(`⚠️ Server ${serverUrl} failed. Skipping...`);
        }
    }
    console.error("❌ All Overpass servers failed.");
    return [];
};

// ==========================================
// 2. CONFIGURATION
// ==========================================
const DENSE_CITIES = [
    'tokyo', 'osaka', 'seoul', 'beijing', 'shanghai', 'hong kong', 'bangkok', 'delhi', 'mumbai',
    'london', 'londres', 'paris', 'rome', 'roma', 'berlin', 'madrid', 'barcelona', 'amsterdam', 
    'venice', 'venecia', 'prague', 'vienna', 'budapest', 'istanbul', 'moscow',
    'new york', 'nueva york', 'san francisco', 'los angeles', 'mexico city', 'cdmx', 'sao paulo', 
    'buenos aires', 'rio de janeiro', 'bogota', 'lima', 'santiago', 'cairo', 'sydney'
];

// ==========================================
// 3. HELPERS (EXTERNAL APIS)
// ==========================================
function getBoundingBox(lat, lon, zoomLevel) {
    const earthCircumference = 40075;
    const radiusKm = (earthCircumference * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoomLevel + 1); 
    const EARTH_RADIUS = 6371;
    const latDelta = (radiusKm / EARTH_RADIUS) * (180 / Math.PI);
    const lonDelta = (radiusKm / EARTH_RADIUS) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);
    return {
        south: parseFloat(lat) - latDelta, north: parseFloat(lat) + latDelta,
        west: parseFloat(lon) - lonDelta, east: parseFloat(lon) + lonDelta
    };
}

async function getNominatimData(locationName) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=1&addressdetails=1&accept-language=en`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 6000 });
        if (res.data && res.data.length > 0) {
            const item = res.data[0];
            return { 
                displayName: item.display_name, type: item.type, class: item.class,
                lat: parseFloat(item.lat), lon: parseFloat(item.lon),
                bbox: item.boundingbox ? {
                    south: parseFloat(item.boundingbox[0]), north: parseFloat(item.boundingbox[1]),
                    west: parseFloat(item.boundingbox[2]), east: parseFloat(item.boundingbox[3])
                } : null
            };
        }
        return null;
    } catch (e) { return null; }
}

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
// 4. WORKER DE FOTOS (CONTROLADO)
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

                    if (name && lat && lon) {
                        let imageList = [];
                        let finalDesc = null;
                        
                        // 1. Wikipedia
                        const wikiData = await getWikipediaData(lat, lon);
                        if (wikiData?.hasData) {
                            if (wikiData.imageUrl) imageList.push(wikiData.imageUrl);
                            finalDesc = wikiData.description;
                        }
                        
                        // 2. Commons
                        if (imageList.length === 0) {
                            const gallery = await getCommonsImages(name);
                            if (gallery.length > 0) imageList.push(...gallery);
                        }

                        // 3. Mapillary
                        if (imageList.length === 0) {
                            const streetPhoto = await getMapillaryImage(lat, lon);
                            if (streetPhoto) imageList.push(streetPhoto);
                        }

                        if (imageList.length > 0 || finalDesc) {
                            const postgresArray = `{${[...new Set(imageList)].map(url => `"${url}"`).join(',')}}`;
                            const mainImage = imageList[0] || null;
                            await db.raw(`UPDATE historical_locations SET images = ?, image_url = ?, description = COALESCE(?, description) WHERE name = ?`, [postgresArray, mainImage, finalDesc, name]);
                        }
                    }
                }
            } catch (err) { /* Silent fail */ }
        }));
        await new Promise(r => setTimeout(r, 150));
    }
};

async function insertElementsToDB(elements, locationLabel = 'Unknown') {
    const insertPromises = elements.map(async (item) => {
        const name = item.tags?.['name:en'] || item.tags?.name || item.tags?.['name:es']; 
        if (!name) return null;
        const iLat = item.lat || item.center?.lat;
        const iLon = item.lon || item.center?.lon;
        let cat = 'Others';
        if (item.tags.historic === 'ruins') cat = 'Ruins';
        else if (item.tags.tourism === 'museum') cat = 'Museums';
        else if (['castle', 'fortress', 'citywalls'].includes(item.tags.historic)) cat = 'Castles';
        const safeAddress = locationLabel.length > 90 ? locationLabel.substring(0, 90) + '...' : locationLabel;
        
        return db.raw(`INSERT INTO historical_locations (name, category, description, country, geom) VALUES (?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ON CONFLICT (name) DO NOTHING`, [name, cat, 'Discovered via exploration.', safeAddress, iLon, iLat]);
    });
    await Promise.all(insertPromises);
}

// ==========================================
// 5. CONTROLADOR PRINCIPAL ACTUALIZADO
// ==========================================
// ==========================================
// 5. CONTROLADOR PRINCIPAL (CON FILTRO DE RADIO)
// ==========================================
export const getLocalizaciones = async (req, res) => {
    req.setTimeout(120000); 

    const search = req.query.q || req.query.search || "";
    const { category, lat, lon } = req.query; 
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    try {
        let selectValues = [], whereValues = [], orderValues = [];
        let selectFields = `id, name, category, image_url, images, description, country, ST_X(geom) AS longitude, ST_Y(geom) AS latitude`;
        
        // 1. SELECT: Calcular distancia si hay coordenadas
        if (lat && lon) {
            selectFields += `, ST_Distance(geom::geography, ST_MakePoint(?, ?)::geography) as distance_meters`;
            selectValues.push(parseFloat(lon), parseFloat(lat)); 
        }

        let baseWhere = `FROM historical_locations WHERE 1=1`;
        
        // --- 2. WHERE: FILTRO DE DISTANCIA (EL FIX CLAVE) ---
        // Si nos pasan lat/lon, filtramos SOLO cosas a menos de 50km.
        // Esto evita que al buscar "Mendoza" te traiga "Bariloche" solo porque ya estaba en la DB.
        if (lat && lon) {
            baseWhere += ` AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, 50000)`; // Radio 50km
            whereValues.push(parseFloat(lon), parseFloat(lat));
        }

        // Filtro Texto
        const searchTerms = getExpandedSearchTerms(search); 
        if (searchTerms.length > 0) {
            const orConditions = [];
            searchTerms.forEach(term => {
                orConditions.push(`(name ILIKE ? OR country ILIKE ?)`);
                whereValues.push(`%${term}%`); whereValues.push(`%${term}%`);
            });
            baseWhere += ` AND (${orConditions.join(' OR ')})`;
        }
        
        // Filtro Categoría
        if (category && category !== 'All') {
            baseWhere += ` AND category = ?`;
            whereValues.push(category);
        }

        // 3. ORDER BY: Cercanía
        let orderByClause = `ORDER BY id DESC`; 
        if (lat && lon) {
            orderByClause = `ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)`;
            orderValues.push(parseFloat(lon), parseFloat(lat)); 
        }

        const finalQuery = `SELECT ${selectFields} ${baseWhere} ${orderByClause} LIMIT ? OFFSET ?`;
        const allValues = [...selectValues, ...whereValues, ...orderValues, limit, offset];
        
        // --- 1. INTENTO LEER DB LOCAL ---
        const initialResult = await db.raw(finalQuery, allValues);
        let dataToSend = initialResult.rows;

        // ===========================================================================
        // CASO A: BÚSQUEDA POR TEXTO (Ej: "London")
        // ===========================================================================
        if (page === 1 && dataToSend.length === 0 && search.length > 3) {
            console.log(`🔎 [Caso A] Buscando Texto: "${search}"`);
            const nominatimInfo = await getNominatimData(search);
            
            if (nominatimInfo && nominatimInfo.type !== 'country') {
                const isArea = ['city','administrative','county','state','town','village','region', 'municipality'].includes(nominatimInfo.type) || ['place','boundary'].includes(nominatimInfo.class);

                if (isArea) {
                    const displayNameLower = nominatimInfo.displayName.toLowerCase();
                    const isDenseCity = DENSE_CITIES.some(city => displayNameLower.includes(city));
                    
                    let bbox;
                    if (nominatimInfo.bbox && !isDenseCity) bbox = nominatimInfo.bbox;
                    else bbox = getBoundingBox(nominatimInfo.lat, nominatimInfo.lon, isDenseCity ? 13.5 : 12);
                    
                    const maxResults = isDenseCity ? 25 : 60;
                    console.log(`🌍 Explorando Texto (Overpass) | Límite: ${maxResults}`);

                    const query = `[out:json][timeout:30];(nwr["historic"~"castle|fortress|ruins"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});nwr["tourism"="museum"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out center ${maxResults};`;
                    const elements = await fetchOverpassData(query, 60000);

                    if (elements.length > 0) {
                        await insertElementsToDB(elements, nominatimInfo.displayName);
                        // Truco: Para volver a leer sin aplicar el filtro de lat/lon estricto (ya que es búsqueda por texto)
                        // podríamos reusar la query, pero aquí está bien porque 'search' está presente.
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
                } else {
                    // Lógica POI (omitida para brevedad, es la misma de siempre)
                }
            }
        }

        // ===========================================================================
        // CASO B: BÚSQUEDA POR COORDENADAS (Dropdown seleccionado)
        // ===========================================================================
        else if (page === 1 && dataToSend.length === 0 && lat && lon) {
            console.log(`📍 [Caso B] Buscando Coordenadas: [${lat}, ${lon}]`);
            console.log("⚠️ DB Local vacía para esta zona (Radio 50km). Consultando Overpass...");
            
            const bbox = getBoundingBox(parseFloat(lat), parseFloat(lon), 13);
            const maxResults = 30;
            const query = `
                [out:json][timeout:30];
                (
                    nwr["historic"="castle"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["historic"="fortress"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["historic"="ruins"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["tourism"="museum"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                );
                out center ${maxResults}; 
            `;

            const elements = await fetchOverpassData(query, 60000);

            if (elements.length > 0) {
                await insertElementsToDB(elements, "Zona Explorada");
                
                // Recargamos DB
                const tempResult = await db.raw(finalQuery, allValues);
                const itemsToProcess = tempResult.rows;

                if (itemsToProcess.length > 0) {
                    const priorityBatch = itemsToProcess.slice(0, 1);
                    const backgroundBatch = itemsToProcess.slice(1);

                    console.log(`🚀 Coordenadas VIP: Procesando 1. Background: ${backgroundBatch.length}`);
                    await Promise.race([
                        processImagesInBatches(priorityBatch),
                        new Promise(resolve => setTimeout(resolve, 3000))
                    ]);

                    if (backgroundBatch.length > 0) {
                        processImagesInBatches(backgroundBatch).catch(err => console.error("Bg Error:", err));
                    }
                }
                
                const finalResult = await db.raw(finalQuery, allValues);
                dataToSend = finalResult.rows;
            }
        }

        // --- 3. RELLENO DE FOTOS ---
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