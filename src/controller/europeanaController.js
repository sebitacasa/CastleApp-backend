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
// 🧹 HELPERS DE LIMPIEZA Y TEXTO
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
    const targetWords = words1.length > 0 ? words1 : n1.split(' ');
    return targetWords.some(w => words2.includes(w));
};

const isInvalidContext = (text, categories = '') => {
    if (!text && !categories) return false;
    const lowerText = (text + ' ' + categories).toLowerCase();

    const placeKeywords = [
        'located', 'situated', 'building', 'monument', 'statue', 'museum', 'castle', 
        'park', 'plaza', 'square', 'church', 'cathedral', 'ruins', 'house of', 'tomb', 
        'grave', 'memorial', 'bridge', 'theater', 'cinema', 'construction', 'tower',
        'palace', 'fortress', 'mansion', 'site', 'venue', 'opened', 'founded', 'built',
        'archaeological', 'temple', 'shrine', 'stolperstein', 'commemorative'
    ];
    const personKeywords = [
        'was a', 'is a', 'born in', 'died in', 'born on', 'died on', 
        'singer', 'actor', 'musician', 'politician', 'player', 'footballer', 
        'writer', 'painter', 'poet', 'priest', 'soldier', 'general', 'king', 
        'queen', 'prince', 'princess', 'composer', 'artist', 'athlete',
        'chanteur', 'sänger', 'biography', 'people', 'living people', 'portrait'
    ];
    const trashKeywords = [
        'clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of',
        'interior of', 'furniture', 'poster', 'advertisement', 'text', 'logo', 'icon',
        'flag', 'coat of arms', 'signature', 'document', 'pdf', 'book cover',
        'underwear', 'panties', 'boxer', 'shorts', 'swimwear', 'stain', 'microscope',
        'insect', 'animal', 'plant', 'flower', 'fungi'
    ];

    const hasPlace = placeKeywords.some(w => lowerText.includes(w));
    const hasPerson = personKeywords.some(w => lowerText.includes(w));
    const hasTrash = trashKeywords.some(w => lowerText.includes(w));

    if (hasTrash) return true;
    if (hasPerson && !hasPlace) return true;
    return false;
};

const isTransportContext = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
        lower.includes('estacion linea') || lower.includes('estación línea') ||
        lower.includes('station on line') || lower.includes('metro station') ||
        lower.includes('subway station') || lower.includes('train station') ||
        lower.includes('railway station')
    );
};

// ==========================================
// 📡 HELPERS EXTERNOS (WIKIPEDIA / COMMONS)
// ==========================================
async function getWikipediaData(lat, lon, targetName) {
    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'geosearch',
            ggscoord: `${lat}|${lon}`, ggsradius: '200', ggslimit: '1', 
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

        return { hasData: true, title: pageData.title, description: description, imageUrl: pageData.thumbnail?.source || null };
    } catch (e) { return null; }
}

async function getWikipediaDataByName(name) {
    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php'; 
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'search',
            gsrsearch: name, gsrlimit: '1', 
            prop: 'extracts|pageimages', exintro: '1', explaintext: '1', pithumbsize: '600'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 3000 });
        const pages = response.data?.query?.pages;
        if (!pages) return null;
        const pageId = Object.keys(pages)[0];
        const pageData = pages[pageId];
        const description = pageData.extract || "";
        if (isInvalidContext(description)) return null;
        return { hasData: true, title: pageData.title, description: description, imageUrl: pageData.thumbnail?.source || null };
    } catch (e) { return null; }
}

async function getCommonsImages(locationName) {
    try {
        const baseUrl = 'https://commons.wikimedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'search',
            gsrsearch: locationName, gsrnamespace: '6', gsrlimit: '3',
            prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800', origin: '*'
        });
        const response = await axios.get(`${baseUrl}?${params.toString()}`, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 3000 });
        const pages = response.data?.query?.pages;
        if (!pages) return [];
        
        const validImages = Object.values(pages).map(p => {
            const info = p.imageinfo?.[0];
            const meta = info?.extmetadata || {};
            const categories = meta.Categories?.value || "";
            const desc = meta.ImageDescription?.value || "";
            if (isInvalidContext(desc, categories)) return null;
            
            const finalUrl = info?.thumburl || info?.url;
            if (!finalUrl) return null;
            const lowerUrl = finalUrl.toLowerCase();
            const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
            if (!validExtensions.some(ext => lowerUrl.includes(ext))) return null;

            return { url: finalUrl, author: cleanWikiText(meta.Artist?.value), license: meta.LicenseShortName?.value };
        }).filter(item => item !== null); 
        return validImages.slice(0, 3);
    } catch (e) { return []; }
}

async function getMapillaryImage(lat, lon) {
    try {
        const MAPILLARY_TOKEN = 'MLY|25296378576723082|c74a374cec37733c10c8879dd9878e67'; 
        const url = `https://graph.mapillary.com/images?access_token=${MAPILLARY_TOKEN}&fields=id,thumb_1024_url&is_pano=false&closeto=${lon},${lat}&radius=50&limit=1`;
        const res = await axios.get(url, { timeout: 2000 });
        return res.data.data?.[0]?.thumb_1024_url || null;
    } catch (e) { return null; }
}

// ==========================================
// ⚙️ WORKER DE FOTOS (BACKGROUND)
// ==========================================
const processImagesInBatches = async (elements) => {
    if (!elements || elements.length === 0) return;
    const BATCH_SIZE = 3; 
    
    for (let i = 0; i < elements.length; i += BATCH_SIZE) {
        const batch = elements.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
            try {
                const hasImages = item.images && item.images.length > 0 && item.images[0] !== null;
                const missingAuthor = !item.author;

                if (!hasImages || missingAuthor) {
                    const name = item.name;
                    const lat = item.latitude || item.lat;
                    const lon = item.longitude || item.lon;

                    if (name) {
                        let bestCandidate = { imageUrl: null, images: [], description: null, author: null, license: null };

                        // 1. Wikipedia
                        let wikiData = null;
                        if (lat && lon) wikiData = await getWikipediaData(lat, lon, name);
                        if (!wikiData?.hasData || !wikiData?.imageUrl) {
                            const cleanName = name.replace(/The |El |La /g, ''); 
                            wikiData = await getWikipediaDataByName(cleanName);
                        }
                        
                        if (wikiData?.hasData && !isTransportContext(wikiData.description)) {
                             if (wikiData.imageUrl) {
                                 bestCandidate.imageUrl = wikiData.imageUrl;
                                 bestCandidate.images.push(wikiData.imageUrl);
                             }
                             bestCandidate.description = wikiData.description;
                        }

                        // 2. Commons
                        if (bestCandidate.images.length === 0) {
                            const gallery = await getCommonsImages(name);
                            if (gallery.length > 0) {
                                if (gallery[0].author) {
                                    bestCandidate.imageUrl = gallery[0].url; 
                                    bestCandidate.author = gallery[0].author;
                                    bestCandidate.license = gallery[0].license;
                                    bestCandidate.images = gallery.map(g => g.url);
                                } else {
                                    bestCandidate.images.push(...gallery.map(g => g.url));
                                }
                            }
                        }

                        // 3. Mapillary
                        if (bestCandidate.images.length === 0 && lat && lon) {
                            const streetPhoto = await getMapillaryImage(lat, lon);
                            if (streetPhoto) {
                                bestCandidate.imageUrl = streetPhoto;
                                bestCandidate.images.push(streetPhoto);
                            }
                        }

                        if (bestCandidate.imageUrl || bestCandidate.description || bestCandidate.author) {
                            const uniqueImages = [...new Set(bestCandidate.images)];
                            const postgresArray = uniqueImages.length > 0 
                                ? `{${uniqueImages.map(url => `"${url}"`).join(',')}}` 
                                : item.images;
                                
                            await db.raw(
                                `UPDATE historical_locations 
                                 SET images = ?, image_url = ?, description = COALESCE(?, description), author = ?, license = ?
                                 WHERE name = ?`, 
                                [postgresArray, bestCandidate.imageUrl || item.image_url, bestCandidate.description, bestCandidate.author || item.author, bestCandidate.license || item.license, name]
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
// 🛡️ EL PORTERO (FILTRO ESTRICTO: SIN MONUMENTS, CON STATUES)
// ==========================================
async function insertElementsToDB(elements, locationLabel = 'Unknown') {
    // 1. LISTA VIP: Agregamos 'Statues', quitamos 'Monuments'
    const ALLOWED_CATEGORIES = new Set([
        'Castles', 'Ruins', 'Museums', 
        'Plaques', 'Busts', 'Stolperstein', 'Historic Site',
        'Statues' 
    ]);

    const insertPromises = elements.map(async (item) => {
        const t = item.tags || {};
        const name = t['name:en'] || t.name || t['name:es']; 
        
        if (!name && t['memorial:type'] !== 'stolperstein') return null;
        if (isTransportContext(name)) return null;

        if (t.railway || t.public_transport || t.highway === 'bus_stop' || 
            t.amenity === 'bus_station' || t.amenity === 'taxi' || 
            t.amenity === 'ferry_terminal' || t.amenity === 'bicycle_rental') return null;

        const iLat = item.lat || item.center?.lat;
        const iLon = item.lon || item.center?.lon;
        
        // --- 🧠 LÓGICA DE CATEGORIZACIÓN MEJORADA ---
        let cat = 'Others';

        if (t.historic === 'ruins') cat = 'Ruins';
        else if (t.tourism === 'museum') cat = 'Museums';
        else if (['castle', 'fortress', 'citywalls', 'manor', 'palace', 'fort'].includes(t.historic)) cat = 'Castles';
        
        // Lógica fina para Memoriales y Estatuas
        else if (t.historic === 'memorial' || t.historic === 'monument') {
            const memType = t['memorial:type'];
            
            if (memType === 'stolperstein') cat = 'Stolperstein';
            else if (memType === 'plaque' || t.historic === 'plaque') cat = 'Plaques';
            else if (memType === 'bust') cat = 'Busts';
            else if (memType === 'statue') cat = 'Statues'; // 👈 Se queda
            else cat = 'Monuments'; // 👈 Se asigna, pero se filtra abajo
        }
        else if (t.tourism === 'artwork') {
             const artType = t['artwork_type'];
             
             if (artType === 'bust') cat = 'Busts';
             else if (artType === 'statue') cat = 'Statues'; // 👈 Se queda
             else cat = 'Monuments'; // Arte abstracto u otros se filtran
        }
        else if (t.historic === 'building' || t.historic === 'archaeological_site' || t.historic === 'battlefield') {
            cat = 'Historic Site';
        }

        // 🚨 FILTRO FINAL: Si es 'Monuments' (u otro no listado), SE DESCARTA
        if (!ALLOWED_CATEGORIES.has(cat)) return null;

        let finalAddress = locationLabel;
        const city = t['addr:city'] || t['addr:town'] || t['addr:village'];
        const street = t['addr:street'];
        if (city) finalAddress = street ? `${street}, ${city}` : city;
        const safeAddress = finalAddress.length > 90 ? finalAddress.substring(0, 90) + '...' : finalAddress;
        
        return db.raw(
            `INSERT INTO historical_locations (name, category, description, country, geom) 
             VALUES (?, ?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) 
             ON CONFLICT (name) DO NOTHING`, 
            [name || 'Stolperstein', cat, 'Discovered via exploration.', safeAddress, iLon, iLat]
        );
    });
    
    await Promise.all(insertPromises);
}

// ==========================================
// 🕹️ CONTROLADOR PRINCIPAL OPTIMIZADO
// ==========================================
export const getLocalizaciones = async (req, res) => {
    req.setTimeout(60000); 

    const search = req.query.q || req.query.search || "";
    const { category, lat, lon } = req.query; 
    const limit = parseInt(req.query.limit) || 50; 
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;

    try {
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
        
        // 🔒 FILTRO SQL: Traer Statues, Ignorar Monuments viejos
        if (!category || category === 'All') {
            baseWhere += ` AND category IN ('Castles', 'Ruins', 'Museums', 'Plaques', 'Busts', 'Stolperstein', 'Historic Site', 'Statues')`;
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
        
        const initialResult = await db.raw(finalQuery, allValues);
        let dataToSend = initialResult.rows;

        // --- LÓGICA DE EXPLORACIÓN EXTERNA ---
        let explorationNeeded = false;
        let bbox = null;
        let areaName = "Explored Area";

        if (page === 1) {
            if (search.length > 3 && dataToSend.length === 0) {
                 const nominatimInfo = await getNominatimData(search);
                 if (nominatimInfo && nominatimInfo.type !== 'country') {
                     const isArea = ['city','administrative','county','town'].includes(nominatimInfo.type);
                     if (isArea) {
                         const displayNameLower = nominatimInfo.displayName.toLowerCase();
                         const isDenseCity = DENSE_CITIES.some(city => displayNameLower.includes(city));
                         bbox = nominatimInfo.bbox || getBoundingBox(nominatimInfo.lat, nominatimInfo.lon, isDenseCity ? 13.5 : 12);
                         areaName = nominatimInfo.displayName;
                         explorationNeeded = true;
                     }
                 }
            } else if (lat && lon && !search) {
                const nearbyItems = dataToSend.filter(i => i.distance_meters && i.distance_meters < 3000);
                if (dataToSend.length < 5 || nearbyItems.length < 2) {
                    areaName = await getReverseNominatim(lat, lon);
                    bbox = getBoundingBox(parseFloat(lat), parseFloat(lon), 12.5);
                    explorationNeeded = true;
                }
            }
        }

        if (explorationNeeded && bbox) {
            console.log(`🌍 Explorando Overpass para: ${areaName}`);
            
            // 🚀 QUERY OVERPASS REFINADA: Solo Statues explícitas, adiós Monuments genéricos
            const overpassQuery = `
                [out:json][timeout:25];
                (
                    nwr["historic"~"castle|fortress|citywalls|manor|palace|fort"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["historic"="ruins"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["tourism"="museum"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    
                    // Memoriales específicos
                    nwr["memorial:type"~"stolperstein|plaque|bust|statue"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    nwr["historic"="plaque"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});

                    // Arte Específico (Estatuas y Bustos solamente)
                    nwr["tourism"="artwork"]["artwork_type"~"bust|statue"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                    
                    nwr["historic"~"archaeological_site|battlefield|building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                );
                (._; >;);
                out center 120;
            `;

            const elements = await fetchOverpassData(overpassQuery, 100000);
            if (elements.length > 0) {
                await insertElementsToDB(elements, areaName);
                const finalResult = await db.raw(finalQuery, allValues);
                dataToSend = finalResult.rows;
            }
        }

        console.log(`⚡ Enviando ${dataToSend.length} resultados al usuario.`);
        res.json({ page, limit, data: dataToSend });

        // --- BACKGROUND PHOTOS ---
        const itemsSinFoto = dataToSend.filter(item => !item.images || item.images.length === 0);
        if (itemsSinFoto.length > 0) {
            console.log(`📸 [Background] Buscando fotos para ${itemsSinFoto.length} lugares...`);
            processImagesInBatches(itemsSinFoto)
                .then(() => console.log("✅ [Background] Fotos actualizadas."))
                .catch(err => console.error("⚠️ [Background] Error:", err.message));
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
        res.set('Cache-Control', 'public, max-age=86400');
        response.data.pipe(res);
    } catch (error) { if (!res.headersSent) res.status(404).end(); }
};