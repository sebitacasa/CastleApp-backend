import axios from 'axios';

// ==========================================
// 1. CONFIGURACIÓN Y CONSTANTES
// ==========================================
const OVERPASS_SERVERS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter'
];

// ==========================================
// 2. OVERPASS API
// ==========================================
export const fetchOverpassData = async (query, timeoutMs = 60000) => {
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
// 3. NOMINATIM API (GEOCODING)
// ==========================================

// Esta es la función que te estaba fallando. ¡Asegúrate de que tenga "export"!
export async function getReverseNominatim(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1&accept-language=es`; 
        const res = await axios.get(url, { headers: { 'User-Agent': 'CastleApp/1.0' }, timeout: 4000 });
        const addr = res.data?.address;
        if (addr) return addr.neighbourhood || addr.suburb || addr.city || addr.town || addr.village || addr.municipality || "Ubicación Detectada";
        return "Zona Explorada";
    } catch (e) { return "Zona Explorada"; }
}

export async function getNominatimData(locationName) {
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

// ==========================================
// 4. WIKIPEDIA & MAPILLARY (FOTOS)
// ==========================================

export async function getWikipediaDataByName(name) {
    try {
        const cleanName = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
        const baseUrl = 'https://en.wikipedia.org/w/api.php';
        
        const searchParams = new URLSearchParams({
            action: 'query', list: 'search', srsearch: cleanName, format: 'json', srlimit: '1'
        });
        const searchRes = await axios.get(`${baseUrl}?${searchParams.toString()}`, { timeout: 4000 });
        const title = searchRes.data?.query?.search?.[0]?.title;

        if (!title) return null;

        const detailParams = new URLSearchParams({
            action: 'query', format: 'json', prop: 'extracts|pageimages', titles: title,
            exintro: '1', explaintext: '1', pithumbsize: '600'
        });
        const detailRes = await axios.get(`${baseUrl}?${detailParams.toString()}`, { timeout: 4000 });
        const pages = detailRes.data?.query?.pages;
        if (!pages) return null;
        
        const pageId = Object.keys(pages)[0];
        if (pageId === "-1") return null;

        return {
            hasData: true,
            title: pages[pageId].title,
            description: pages[pageId].extract ? pages[pageId].extract.substring(0, 400) + "..." : null,
            imageUrl: pages[pageId].thumbnail?.source || null
        };
    } catch (e) { return null; }
}

export async function getWikipediaDataByCoords(lat, lon) {
    try {
        const baseUrl = 'https://en.wikipedia.org/w/api.php';
        const params = new URLSearchParams({
            action: 'query', format: 'json', generator: 'geosearch',
            ggscoord: `${lat}|${lon}`, 
            ggsradius: '100', 
            ggslimit: '1',
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

export async function getCommonsImages(locationName) {
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

export async function getMapillaryImage(lat, lon) {
    try {
        const MAPILLARY_TOKEN = 'MLY|25296378576723082|c74a374cec37733c10c8879dd9878e67'; 
        const url = `https://graph.mapillary.com/images?access_token=${MAPILLARY_TOKEN}&fields=id,thumb_1024_url&is_pano=false&closeto=${lon},${lat}&radius=1000&limit=1`;
        const res = await axios.get(url, { timeout: 4000 });
        return res.data.data?.[0]?.thumb_1024_url || null;
    } catch (e) { return null; }
}