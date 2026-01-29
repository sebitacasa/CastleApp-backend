import db from '../config/db.js';
import axios from 'axios';
import { getExpandedSearchTerms } from '../utils/synonyms.js';

import { DENSE_CITIES, getBoundingBox } from '../utils/geoUtils.js';
import { 
    fetchOverpassData, 
    getNominatimData, 
    getReverseNominatim 
} from '../services/externalApis.js'; 

// ==========================================
// 🧹 HELPERS DE LIMPIEZA
// ==========================================
const cleanWikiText = (html) => {
    if (!html) return null;
    return html.replace(/<[^>]*>?/gm, '').trim();
};

const areNamesSimilar = (name1, name2) => {
    if (!name1 || !name2) return false;
    const n1 = name1.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const n2 = name2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (n1.includes(n2) || n2.includes(n1)) return true;
    const words1 = n1.split(' ').filter(w => w.length >= 4);
    const words2 = n2.split(' ');
    const matches = words1.filter(w => words2.includes(w));
    return matches.length >= 1; 
};

// 🔥 MANTENEMOS EL FILTRO DE FOTOS MALAS (Esto estaba bien)
const isInvalidImage = (url, title = '') => {
    if (!url) return true;
    const lowerUrl = url.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const badKeywords = [
        'svg', 'logo', 'icon', 'map', 'diagram', 'chart', 'plan', 'drawing', 'sketch',
        'textile', 'clothing', 'shirt', 'fabric', 'underwear', 'garment', 'hat',
        'food', 'dish', 'plate', 'menu', 'bottle',
        'interior', 'room', 'furniture', 'chair', 'table', 'shelf',
        'book', 'paper', 'document', 'scan', 'page', 'postcard', 'album', 'photo_album',
        'collection', 'archive', 'ephemera', 'pile', 'stack', 'box', 'letters',
        'signature', 'stamp', 'currency', 'coin', 'portrait', 'headshot'
    ];
    if (badKeywords.some(k => lowerUrl.includes(k) || lowerTitle.includes(k))) return true;
    return false;
};

// 🔓 RELAJAMOS EL FILTRO DE TEXTO
// Ya no borramos si habla de una persona, porque muchos edificios llevan nombres de personas.
const isInvalidContext = (text, categories = '') => {
    if (!text && !categories) return false;
    const lowerText = (text + ' ' + categories).toLowerCase();
    
    // Basura real que queremos evitar
    const trashKeywords = [
        'clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of',
        'furniture', 'poster', 'advertisement', 'logo', 'icon',
        'coat of arms', 'signature', 'document', 'pdf', 'book cover',
        'panties', 'boxer', 'shorts', 'swimwear', 'microscope',
        'insect', 'animal', 'plant', 'flower', 'fungi', 'textile'
    ];
    
    if (trashKeywords.some(w => lowerText.includes(w))) return true;
    // Solo si es MUY corto y no dice nada útil lo borramos
    if (lowerText.length < 40) return true; 
    
    return false;
};

const isTransportContext = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
        lower.includes('estacion linea') || lower.includes('estación línea') ||
        lower.includes('station on line') || lower.includes('metro station') ||
        lower.includes('subway station') || lower.includes('train station') ||
        lower.includes('railway station') || lower.includes('bus stop')
    );
};

const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 99999; 
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
};

// ==========================================
// 📡 HELPERS EXTERNOS
// ==========================================
async function getWikipediaData(lat, lon, targetName) {
    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'geosearch',
            ggscoord: `${lat}|${lon}`, ggsradius: '100', ggslimit: '1', 
            prop: 'extracts|pageimages', exintro: '1', explaintext: '1', pithumbsize: '600'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 3000 });
        const pages = response.data?.query?.pages;
        if (!pages) return null;
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];
        const description = pages[pageId].extract || "";
        
        if (targetName && !areNamesSimilar(pageData.title, targetName)) return null; 
        if (isInvalidContext(description)) return null;

        let img = pageData.thumbnail?.source || null;
        if (isInvalidImage(img, pageData.title)) img = null;

        return { hasData: true, title: pageData.title, description: description, imageUrl: img };
    } catch (e) { return null; }
}

async function getWikipediaDataByName(name) {
    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php'; 
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'search',
            gsrsearch: name, gsrlimit: '1', 
            prop: 'extracts|pageimages|coordinates', 
            exintro: '1', explaintext: '1', pithumbsize: '600'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 3000 });
        const pages = response.data?.query?.pages;
        if (!pages) return null;
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];
        const description = pageData.extract || "";
        if (isInvalidContext(description)) return null;
        const coords = pageData.coordinates ? pageData.coordinates[0] : null;
        
        let img = pageData.thumbnail?.source || null;
        if (isInvalidImage(img, pageData.title)) img = null;

        return { 
            hasData: true, title: pageData.title, description: description, 
            imageUrl: img,
            wikiLat: coords ? coords.lat : null, wikiLon: coords ? coords.lon : null
        };
    } catch (e) { return null; }
}

async function getCommonsImages(locationName) {
    try {
        const baseUrl = 'https://commons.wikimedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'search',
            gsrsearch: `${locationName}`, 
            gsrnamespace: '6', gsrlimit: '3',
            prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800', origin: '*'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 3000 });
        const pages = response.data?.query?.pages;
        if (!pages) return [];
        
        const validImages = Object.values(pages).map(p => {
            const info = p.imageinfo?.[0];
            const meta = info?.extmetadata || {};
            const finalUrl = info?.thumburl || info?.url;
            const title = p.title || '';
            if (!finalUrl || isInvalidImage(finalUrl, title)) return null;
            const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
            if (!validExtensions.some(ext => finalUrl.toLowerCase().includes(ext))) return null;
            return { url: finalUrl, author: cleanWikiText(meta.Artist?.value), license: meta.LicenseShortName?.value };
        }).filter(item => item !== null); 
        return validImages.slice(0, 1); 
    } catch (e) { return []; }
}

async function getMapillaryImage(lat, lon) {
    try {
        const MAPILLARY_TOKEN = 'MLY|25296378576723082|c74a374cec37733c10c8879dd9878e67'; 
        const url = `https://graph.mapillary.com/images?access_token=${MAPILLARY_TOKEN}&fields=id,thumb_1024_url&is_pano=false&closeto=${lon},${lat}&radius=30&limit=1`;
        const res = await axios.get(url, { timeout: 2000 });
        return res.data.data?.[0]?.thumb_1024_url || null;
    } catch (e) { return null; }
}

// ==========================================
// ⚙️ WORKER DE FOTOS
// ==========================================
const processImagesInBatches = async (elements) => {
    if (!elements || elements.length === 0) return;
    const BATCH_SIZE = 2; 
    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
        const batch = elements.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
            try {
                const hasImages = item.images && item.images.length > 0 && item.images[0] !== null;
                if (!hasImages) {
                    const name = item.name;
                    const lat = item.latitude || item.lat;
                    const lon = item.longitude || item.lon;
                    if (name) {
                        let bestCandidate = { imageUrl: null, images: [], description: null, author: null, license: null };
                        
                        let wikiData = null;
                        if (lat && lon) wikiData = await getWikipediaData(lat, lon, name);
                        if (!wikiData?.hasData || !wikiData?.imageUrl) {
                            const cleanName = name.replace(/The |El |La /g, ''); 
                            const searchQuery = item.country ? `${cleanName} ${item.country}` : cleanName;
                            const textResult = await getWikipediaDataByName(searchQuery);
                            if (textResult && textResult.wikiLat && textResult.wikiLon && lat && lon) {
                                const dist = getDistanceFromLatLonInKm(lat, lon, textResult.wikiLat, textResult.wikiLon);
                                if (dist < 40) wikiData = textResult; 
                            }
                        }
                        
                        if (wikiData?.hasData && !isTransportContext(wikiData.description)) {
                             if (wikiData.imageUrl) {
                                 bestCandidate.imageUrl = wikiData.imageUrl;
                                 bestCandidate.images.push(wikiData.imageUrl);
                             }
                             bestCandidate.description = wikiData.description;
                        }

                        if (bestCandidate.images.length === 0) {
                            const gallery = await getCommonsImages(name);
                            if (gallery.length > 0) bestCandidate.imageUrl = gallery[0].url; 
                        }

                        if (bestCandidate.images.length === 0 && lat && lon) {
                            const streetPhoto = await getMapillaryImage(lat, lon);
                            if (streetPhoto) bestCandidate.imageUrl = streetPhoto;
                        }

                        if (bestCandidate.imageUrl || bestCandidate.description) {
                            const uniqueImages = [...new Set(bestCandidate.images)];
                            const postgresArray = uniqueImages.length > 0 ? `{${uniqueImages.map(url => `"${url}"`).join(',')}}` : null; 
                            
                            await db.raw(
                                `UPDATE historical_locations 
                                 SET images = ?, image_url = ?, description = COALESCE(?, description), author = ?, license = ?
                                 WHERE name = ?`, 
                                [postgresArray, bestCandidate.imageUrl || null, bestCandidate.description, bestCandidate.author || null, bestCandidate.license || null, name]
                            );
                        }
                    }
                }
            } catch (err) { console.error(`Err Background ${item.name}: ${err.message}`); }
        }));
        await new Promise(r => setTimeout(r, 500));
    }
};

// ==========================================
// 🛡️ EL PORTERO (AMPLIADO OTRA VEZ) 🌟
// ==========================================
async function insertElementsToDB(elements, locationLabel = 'Unknown') {
    // 🔙 RESTAURAMOS LAS CATEGORÍAS GENERALES
    const ALLOWED_CATEGORIES = new Set([
        'Castles', 'Ruins', 'Museums', 
        'Stolperstein', 'Religious', 'Towers',
        'Statues', 'Busts', 'Plaques', 
        'Historic Site', 'Tourist', 'Monuments' // ✅ Vuelven a entrar
    ]);

    const validRows = [];
    
    for (const item of elements) {
        const t = item.tags || {};
        const name = t['name:en'] || t.name || t['name:es']; 
        
        if (!name && t['memorial:type'] !== 'stolperstein') continue;
        if (isTransportContext(name)) continue;

        // Filtro de basura rápido
        if (t.railway || t.public_transport || t.highway || t.shop || 
            t.amenity === 'bus_station' || t.amenity === 'taxi' || 
            t.amenity === 'parking' || t.amenity === 'atm' || 
            t.amenity === 'restaurant' || t.amenity === 'cafe') continue;

        let cat = 'Historic Site'; // Valor por defecto para cosas históricas

        // 1. CLASIFICACIÓN
        if (t.historic === 'ruins') cat = 'Ruins';
        else if (['castle', 'fortress', 'citywalls', 'manor', 'palace', 'fort'].includes(t.historic)) cat = 'Castles';
        else if (t.tourism === 'museum') cat = 'Museums';
        else if (t.amenity === 'place_of_worship' || t.amenity === 'monastery' || t.historic === 'church' || t.historic === 'monastery' || t.building === 'cathedral') cat = 'Religious';
        else if (['tower', 'city_gate', 'fountain', 'bridge', 'aqueduct'].includes(t.historic)) cat = 'Towers';
        else if (t.tourism === 'viewpoint' || t.tourism === 'attraction') cat = 'Tourist';
        
        else if (t.historic === 'memorial' || t.tourism === 'artwork') {
            const memType = t['memorial:type'];
            if (memType === 'stolperstein') cat = 'Stolperstein';
            else if (memType === 'plaque' || t.historic === 'plaque') cat = 'Plaques';
            else if (memType === 'bust') cat = 'Busts';
            else if (memType === 'statue') cat = 'Statues'; 
            else if (t.historic === 'wayside_shrine') cat = 'Religious'; 
            else cat = 'Monuments'; 
        }

        if (cat && ALLOWED_CATEGORIES.has(cat)) {
            let finalAddress = locationLabel;
            const city = t['addr:city'] || t['addr:town'];
            const street = t['addr:street'];
            if (city) finalAddress = street ? `${street}, ${city}` : city;
            const safeAddress = finalAddress.length > 90 ? finalAddress.substring(0, 90) + '...' : finalAddress;
            const iLat = item.lat || item.center?.lat;
            const iLon = item.lon || item.center?.lon;

            validRows.push({
                name: name || 'Stolperstein',
                category: cat,
                description: 'Discovered via exploration.',
                country: safeAddress,
                lat: iLat,
                lon: iLon
            });
        }
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(row => 
            db.raw(
                `INSERT INTO historical_locations (name, category, description, country, geom) 
                 VALUES (?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) 
                 ON CONFLICT (name) DO NOTHING`, 
                [row.name, row.category, row.description, row.country, row.lon, row.lat]
            )
        ));
    }
}

// ==========================================
// 🕹️ CONTROLADOR PRINCIPAL
// ==========================================
export const getLocalizaciones = async (req, res) => {
    req.setTimeout(30000); 

    const search = req.query.q || req.query.search || "";
    const { category, lat, lon } = req.query; 
    const limit = parseInt(req.query.limit) || 50; 
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    const fetchFromDB = async () => {
        let selectValues = [], whereValues = [], orderValues = [];
        let selectFields = `
            id, name, category, image_url, images, author, license,
            CASE WHEN LENGTH(description) > 180 THEN LEFT(description, 180) || '...' ELSE description END AS description,
            country, ST_X(geom) AS longitude, ST_Y(geom) AS latitude
        `;
        if (lat && lon) {
            selectFields += `, ST_Distance(geom::geography, ST_MakePoint(?, ?)::geography) as distance_meters`;
            selectValues.push(parseFloat(lon), parseFloat(lat)); 
        }

        let baseWhere = `FROM historical_locations WHERE 1=1`;
        if (!category || category === 'All') {
            baseWhere += ` AND category IN ('Castles', 'Ruins', 'Museums', 'Plaques', 'Busts', 'Stolperstein', 'Statues', 'Religious', 'Towers', 'Historic Site', 'Monuments', 'Tourist')`;
        } else {
            baseWhere += ` AND category = ?`;
            whereValues.push(category);
        }

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
        
        let orderByClause = `ORDER BY id DESC`; 
        if (lat && lon && !search) {
            orderByClause = `ORDER BY geom <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)`;
            orderValues.push(parseFloat(lon), parseFloat(lat)); 
        }

        const finalQuery = `SELECT ${selectFields} ${baseWhere} ${orderByClause} LIMIT ? OFFSET ?`;
        const allValues = [...selectValues, ...whereValues, ...orderValues, limit, offset];
        const result = await db.raw(finalQuery, allValues);
        return result.rows;
    };

    try {
        let dataToSend = await fetchFromDB();

        let explorationNeeded = false;
        let bbox = null;
        let areaName = "Explored Area";

        if (page === 1) {
            if (search.length > 3 && dataToSend.length < 5) {
                 const nominatimInfo = await getNominatimData(search);
                 if (nominatimInfo && nominatimInfo.type !== 'country') {
                     const isArea = ['city','administrative','county','town'].includes(nominatimInfo.type);
                     if (isArea) {
                         bbox = nominatimInfo.bbox || getBoundingBox(nominatimInfo.lat, nominatimInfo.lon, 15); 
                         areaName = nominatimInfo.displayName;
                         explorationNeeded = true;
                     }
                 }
            } else if (lat && lon && !search) {
                const nearbyItems = dataToSend.filter(i => i.distance_meters && i.distance_meters < 1000);
                if (dataToSend.length < 5 || nearbyItems.length < 3) {
                    areaName = await getReverseNominatim(lat, lon);
                    bbox = getBoundingBox(parseFloat(lat), parseFloat(lon), 15);
                    explorationNeeded = true;
                }
            }
        }

        if (explorationNeeded && bbox) {
            console.log(`🌍 Deep Scan (Broad) en ${areaName}...`);
            
            // 🔥 QUERY AMPLIA OTRA VEZ:
            // Volvemos a pedir 'historic' y 'tourism' genéricos para captar todo lo que nos perdimos.
            const overpassQuery = `
                [out:json][timeout:15];
                (
                    nwr["historic"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["tourism"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["landmark"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                );
                (._; >;);
                out center;
            `;

            try {
                // Timeout de seguridad de 10 segundos
                const fetchPromise = fetchOverpassData(overpassQuery, 250000);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_OVERPASS')), 10000));
                const elements = await Promise.race([fetchPromise, timeoutPromise]);

                if (elements && elements.length > 0) {
                    console.log(`✅ Overpass encontró ${elements.length} lugares.`);
                    await insertElementsToDB(elements, areaName);
                    dataToSend = await fetchFromDB();
                }
            } catch (err) {
                console.log("⏩ Timeout de exploración.");
            }
        }

        console.log(`⚡ Enviando ${dataToSend.length} resultados.`);
        res.json({ page, limit, data: dataToSend });

        const itemsSinFoto = dataToSend.filter(item => !item.images || item.images.length === 0);
        if (itemsSinFoto.length > 0) {
            processImagesInBatches(itemsSinFoto).catch(err => console.error(err));
        }

    } catch (error) {
        console.error("🔥 Error Controller:", error.message);
        if (!res.headersSent) res.status(500).json({ error: "Server Error" });
    }
};

export const getLocationDescription = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.raw(`SELECT description FROM historical_locations WHERE id = ?`, [id]);
        if (result.rows.length > 0) res.json({ description: result.rows[0].description });
        else res.status(404).json({ error: "Lugar no encontrado" });
    } catch (error) { res.status(500).json({ error: "Error de servidor" }); }
};

export const getProxyImage = async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) return res.status(400).send('Falta URL');
        const response = await axios({ url: decodeURIComponent(url), method: 'GET', responseType: 'stream', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        res.set('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) { if (!res.headersSent) res.status(404).end(); }
};