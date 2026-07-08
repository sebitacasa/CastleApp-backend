import { Request, Response } from 'express';
import axios from 'axios';
import countryLanguage from 'country-language';
import db from '../config/db.js';

const GOOGLE_API_KEY: string | undefined = process.env.GOOGLE_API_KEY;

const WIKI_OPTS = {
    headers: {
        'User-Agent': 'CastleApp/1.0 (https://github.com/sebitacasa/CastleApp-backend; contact via GitHub issues)'
    },
    timeout: 6000
};

// ==========================================
// CACHE EN MEMORIA PARA RESULTADOS DE GOOGLE
// ==========================================
interface CacheEntry {
    data: any[];
    ts: number;
}
const PLACES_CACHE = new Map<string, CacheEntry>();
const PLACES_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

function getPlacesCache(key: string): any[] | null {
    const entry = PLACES_CACHE.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > PLACES_CACHE_TTL) { PLACES_CACHE.delete(key); return null; }
    return entry.data;
}

function setPlacesCache(key: string, data: any[]): void {
    PLACES_CACHE.set(key, { data, ts: Date.now() });
    if (PLACES_CACHE.size > 200) PLACES_CACHE.delete(PLACES_CACHE.keys().next().value!);
}

// ==========================================
// TIPOS DE GOOGLE PLACES POR CATEGORÍA
// ==========================================
const HISTORIC_TYPE_GROUPS: Record<string, string[]> = {
    'Castles':      ['castle'],
    'Historic Site':['historical_landmark', 'historical_place', 'cultural_landmark', 'monument', 'sculpture'],
    'Ruins':        ['historical_landmark', 'historical_place', 'cultural_landmark'],
    'Museums':      ['museum', 'art_museum', 'history_museum', 'art_gallery'],
    'Religious':    ['church', 'synagogue', 'mosque', 'hindu_temple', 'buddhist_temple', 'shinto_shrine'],
};

const DEFAULT_GROUPS = ['Castles', 'Historic Site', 'Museums', 'Religious'];

const getGroupsForCategory = (category: string | undefined): string[] => {
    if (category && HISTORIC_TYPE_GROUPS[category]) return [category];
    return DEFAULT_GROUPS;
};

const TYPE_TO_CATEGORY: Record<string, string> = {
    castle: 'Castles',
    historical_landmark: 'Historic Site',
    historical_place: 'Historic Site',
    cultural_landmark: 'Historic Site',
    monument: 'Statues',
    sculpture: 'Statues',
    museum: 'Museums',
    art_museum: 'Museums',
    history_museum: 'Museums',
    art_gallery: 'Museums',
    church: 'Religious',
    synagogue: 'Religious',
    mosque: 'Religious',
    hindu_temple: 'Religious',
    buddhist_temple: 'Religious',
    shinto_shrine: 'Religious',
};

const RUIN_KEYWORDS = ['ruin', 'ruina', 'ruines', 'rovina', 'trosky', 'rudera'];

// ==========================================
// LÓGICA DE CLASIFICACIÓN
// ==========================================
const detectCategory = (primaryType: string | undefined, googleTypes: string[] = [], name: string = ''): string => {
    const nameLower = (name || '').toLowerCase();
    if (RUIN_KEYWORDS.some(k => nameLower.includes(k))) return 'Ruins';
    if (primaryType && TYPE_TO_CATEGORY[primaryType]) return TYPE_TO_CATEGORY[primaryType];
    for (const t of googleTypes) {
        if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
    }
    return 'Historic Site';
};

// ==========================================
// HELPERS
// ==========================================
const INVALID_CONTEXT_WORDS = ['clothing', 'underwear', 'medical', 'anatomy', 'diagram', 'map of', 'plan of', 'furniture', 'poster', 'advertisement', 'logo', 'icon', 'signature', 'document', 'shop', 'store', 'hotel', 'restaurant'];
const INVALID_CONTEXT_REGEX = new RegExp(`\\b(${INVALID_CONTEXT_WORDS.join('|')})\\b`, 'i');
const isInvalidContext = (text: string | null | undefined): boolean => {
    if (!text) return false;
    return INVALID_CONTEXT_REGEX.test(text);
};

const GENERIC_WORDS = [
    'saint', 'santo', 'santa', 'santi', 'san', 'sant', 'st',
    'basilica', 'chiesa', 'church', 'cathedral', 'cattedrale', 'duomo',
    'papal', 'pontificio', 'pontifical', 'santuario', 'sanctuary', 'shrine',
    'abbey', 'abbazia', 'monastery', 'monastero', 'convent', 'convento',
    'temple', 'tempio', 'chapel', 'cappella', 'hermitage', 'eremo',
    'castle', 'castello', 'chateau', 'château', 'schloss', 'burg',
    'palace', 'palazzo', 'palais', 'villa', 'casale', 'manor', 'maniero', 'mansion',
    'tower', 'torre', 'turm', 'fort', 'fortress', 'fortezza', 'festung',
    'citadel', 'cittadella', 'rocca', 'stronghold', 'keep',
    'ruins', 'ruina', 'rovina', 'rovine',
    'museum', 'museo', 'gallery', 'galleria',
    'of', 'the', 'and', 'in', 'di', 'dei', 'degli', 'della', 'del', 'la', 'le', 'il', 'e',
];

const areNamesSimilar = (placeName: string | null | undefined, wikiTitle: string | null | undefined): boolean => {
    if (!placeName || !wikiTitle) return false;
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
    const a = norm(placeName);
    const b = norm(wikiTitle);
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;

    const bWords = b.split(' ');
    const aWords = a.split(' ').filter(w => w.length >= 4);
    const significantWords = aWords.filter(w => !GENERIC_WORDS.includes(w));

    if (significantWords.length === 0) return aWords.some(w => bWords.includes(w));
    return significantWords.every(w => bWords.includes(w));
};

// ==========================================
// IDIOMA LOCAL DE WIKIPEDIA SEGÚN EL PAÍS
// ==========================================
const getWikiLangsForCountry = (countryCode: string | null | undefined): string[] => {
    if (!countryCode) return [];
    const langs = countryLanguage.getCountry(countryCode)?.languages || [];
    const sorted = [...langs].sort((a, b) => (a.countries?.length || 0) - (b.countries?.length || 0));
    const codes = sorted.map(l => l.iso639_1).filter((c): c is string => !!c);
    return [...new Set(codes)].filter(c => c !== 'en').slice(0, 3);
};

const extractCountryCode = (addressComponents: any[] | undefined): string | null => {
    if (!Array.isArray(addressComponents)) return null;
    const countryComp = addressComponents.find((c: any) => c.types?.includes('country'));
    return countryComp?.shortText || null;
};

interface WikiArticle {
    title: string;
    extract: string;
    imageUrl: string | null;
    wikiUrl: string | null;
}

const fetchWikipediaArticle = async (title: string, lang: string): Promise<WikiArticle | null> => {
    const baseUrl = `https://${lang}.wikipedia.org/w/api.php`;
    const detailsUrl = `${baseUrl}?action=query&prop=extracts|pageimages|info&exintro&explaintext&piprop=original&inprop=url&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const detailsRes = await axios.get(detailsUrl, WIKI_OPTS);
    const pages = detailsRes.data?.query?.pages;
    if (!pages) return null;
    const pageId = Object.keys(pages)[0];
    if (pageId === '-1' || !pages[pageId].extract) return null;
    const pageData = pages[pageId];
    return {
        title: pageData.title || title,
        extract: pageData.extract,
        imageUrl: pageData.original?.source || null,
        wikiUrl: pageData.fullurl || null,
    };
};

interface ArticleResult {
    article: WikiArticle;
    isEnglish: boolean;
}

const resolveWikipediaArticle = async (name: string, lang: string): Promise<ArticleResult | null> => {
    const baseUrl = `https://${lang}.wikipedia.org/w/api.php`;
    const searchUrl = `${baseUrl}?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1&origin=*`;
    const searchRes = await axios.get(searchUrl, WIKI_OPTS);
    const title: string | undefined = searchRes.data?.query?.search?.[0]?.title;

    if (!title || !areNamesSimilar(name, title)) return null;

    if (lang !== 'en') {
        const langlinksUrl = `${baseUrl}?action=query&prop=langlinks&lllang=en&titles=${encodeURIComponent(title)}&format=json&origin=*`;
        const langRes = await axios.get(langlinksUrl, WIKI_OPTS);
        const langPages = langRes.data?.query?.pages;
        const langPageId: string | undefined = langPages ? Object.keys(langPages)[0] : undefined;
        const enTitle: string | undefined = langPageId
            ? (langPages[langPageId].langlinks?.[0]?.['*'] || langPages[langPageId].langlinks?.[0]?.title)
            : undefined;

        if (enTitle) {
            const enArticle = await fetchWikipediaArticle(enTitle, 'en');
            if (enArticle) return { article: enArticle, isEnglish: true };
        }
    }

    const localArticle = await fetchWikipediaArticle(title, lang);
    return localArticle ? { article: localArticle, isEnglish: lang === 'en' } : null;
};

const resolveWikipediaArticleForCountry = async (name: string, countryCode: string | null | undefined): Promise<WikiArticle | null> => {
    const candidateLangs = getWikiLangsForCountry(countryCode);
    let localFallback: WikiArticle | null = null;
    for (const lang of candidateLangs) {
        const result = await resolveWikipediaArticle(name, lang);
        if (result?.isEnglish) return result.article;
        if (result && !localFallback) localFallback = result.article;
    }
    const enResult = await resolveWikipediaArticle(name, 'en');
    if (enResult) return enResult.article;
    return localFallback;
};

interface WikiSummary {
    title: string;
    description: string;
    imageUrl: string | null;
}

const getWikipediaByName = async (name: string | null | undefined, countryCode: string | null): Promise<WikiSummary | null> => {
    if (!name) return null;
    try {
        const article = await resolveWikipediaArticleForCountry(name, countryCode);
        if (!article) return null;
        const description = article.extract.substring(0, 300) + '...';
        if (isInvalidContext(description)) return null;
        return { title: article.title, description, imageUrl: article.imageUrl };
    } catch (error) {
        const e = error as any;
        console.error(`🔥 Wikipedia lookup "${name}" (${countryCode}):`, e.response?.status || e.message);
        return null;
    }
};

// ==========================================
// AUXILIAR DB
// ==========================================
async function fetchFromDatabase(lat: string, lon: string, maxKm: number = 50, page: number = 1): Promise<any[]> {
    if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
        console.warn('⚠️ fetchFromDatabase: Coordenadas inválidas recibidas:', { lat, lon });
        return [];
    }
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const limit = 20;
    const offset = (page - 1) * limit;
    try {
        const query = `
            SELECT *,
            (6371 * acos(
                cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(latitude))
            )) AS distance
            FROM historical_locations
            WHERE is_approved = TRUE
            AND (6371 * acos(
                cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(latitude))
            )) < ?
            ORDER BY distance ASC
            LIMIT ? OFFSET ?
        `;
        const r = await db.raw(query, [latNum, lonNum, latNum, latNum, lonNum, latNum, maxKm, limit, offset]);
        return r.rows.map((row: any) => ({
            id: row.id.toString(),
            name: row.name,
            description: row.description,
            latitude: parseFloat(row.latitude),
            longitude: parseFloat(row.longitude),
            image_url: row.image_url,
            source: 'db',
            is_yours: true,
            country: row.location_text || 'Community',
            category: row.category || 'Others',
            distance: row.distance
        }));
    } catch (err) {
        const e = err as Error;
        console.error('🔥 Error CRÍTICO en DB:', e.message);
        return [];
    }
}

// ─── Auxiliar Google: Nearby Search ─────────────────────────────────────────
async function searchNearbyByTypes(lat: string, lon: string, radius: number, types: string[]): Promise<any[]> {
    try {
        const url = 'https://places.googleapis.com/v1/places:searchNearby';
        const requestBody = {
            includedTypes: types,
            maxResultCount: 20,
            rankPreference: 'DISTANCE',
            locationRestriction: {
                circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius }
            }
        };
        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.photos,places.types,places.primaryType'
        };
        const response = await axios.post(url, requestBody, { headers });
        return response.data.places || [];
    } catch (err) {
        const e = err as any;
        console.error(`🔥 ERROR Nearby Search [${types.join(',')}]:`, e.response?.data || e.message);
        return [];
    }
}

// ─── Auxiliar Google: combina grupos, deduplica y enriquece ─────────────────
async function fetchFromGoogle(lat: string, lon: string, radius: number, category: string | undefined): Promise<any[]> {
    try {
        const groupNames = getGroupsForCategory(category);
        const rawBatches = await Promise.all(
            groupNames.map(g => searchNearbyByTypes(lat, lon, radius, HISTORIC_TYPE_GROUPS[g]))
        );

        const seen = new Map<string, any>();
        rawBatches.flat().forEach((p: any) => { if (p?.id && !seen.has(p.id)) seen.set(p.id, p); });
        const places = Array.from(seen.values());

        const enrichedData = await Promise.all(places.map(async (p: any) => {
            const pLat: number = p.location.latitude;
            const pLon: number = p.location.longitude;
            const pName: string = p.displayName?.text;

            if (isInvalidContext(pName)) return null;

            let finalDesc: string = p.formattedAddress;
            const photoName: string | undefined = p.photos?.[0]?.name;
            let finalImage: string | null = photoName
                ? `https://places.googleapis.com/v1/${photoName}/media?key=${GOOGLE_API_KEY}&maxHeightPx=800&maxWidthPx=800`
                : null;
            let imageSource: string | null = finalImage ? 'google' : null;
            if (!photoName) {
                console.log(`📸 sin foto Google para "${pName}" (primaryType=${p.primaryType})`);
            }
            let wikiTitle: string | null = null;

            const countryCode = extractCountryCode(p.addressComponents);
            const wikiData = await getWikipediaByName(pName, countryCode);
            if (wikiData) {
                if (wikiData.description) finalDesc = wikiData.description;
                if (!finalImage && wikiData.imageUrl) {
                    finalImage = wikiData.imageUrl;
                    imageSource = 'wikipedia';
                }
                wikiTitle = wikiData.title;
            }

            let shortAddress: string = p.formattedAddress;
            if (shortAddress && shortAddress.split(',').length >= 2) {
                shortAddress = shortAddress.split(',').slice(-2).join(',').trim();
            }

            const detectedCat = detectCategory(p.primaryType, p.types, pName);

            return {
                id: p.id, name: pName, description: finalDesc, latitude: pLat, longitude: pLon,
                image_url: finalImage,
                image_source: imageSource,
                category: detectedCat,
                source: 'google',
                google_place_id: p.id,
                address: p.formattedAddress,
                country: shortAddress,
                country_code: countryCode,
                wiki_title: wikiTitle
            };
        }));

        return enrichedData.filter((item): item is NonNullable<typeof item> => item !== null);
    } catch (err) {
        const e = err as any;
        console.error('🔥 ERROR GOOGLE API:', e.response?.data || e.message);
        return [];
    }
}

// ==========================================
// 1. MAPA HÍBRIDO (GET /)
// ==========================================
export const getLocations = async (req: Request, res: Response) => {
    const lat  = typeof req.query.lat      === 'string' ? req.query.lat      : undefined;
    const lon  = typeof req.query.lon      === 'string' ? req.query.lon      : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const targetCategory = category || 'All';
    const currentPage = parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10) || 1;
    const shouldRefresh = req.query.refresh === '1';

    const googleRadius = 50000;
    const PAGE_SIZE = 20;

    if (!lat || !lon) return res.status(400).json({ error: 'Faltan coordenadas (lat, lon)' });

    const cacheKey = `${parseFloat(lat).toFixed(2)}_${parseFloat(lon).toFixed(2)}_${targetCategory}`;
    if (shouldRefresh) PLACES_CACHE.delete(cacheKey);

    try {
        const dbResults = await fetchFromDatabase(lat, lon, 50, currentPage);

        let allGooglePlaces: any[] = [];
        if (targetCategory !== 'Community') {
            allGooglePlaces = getPlacesCache(cacheKey) ?? [];
            if (!allGooglePlaces.length) {
                allGooglePlaces = await fetchFromGoogle(lat, lon, googleRadius, targetCategory);
                const latNum = parseFloat(lat);
                const lonNum = parseFloat(lon);
                allGooglePlaces.sort((a, b) => {
                    const dA = Math.hypot((a.latitude || 0) - latNum, (a.longitude || 0) - lonNum);
                    const dB = Math.hypot((b.latitude || 0) - latNum, (b.longitude || 0) - lonNum);
                    return dA - dB;
                });
                setPlacesCache(cacheKey, allGooglePlaces);
            }
        }

        const googleOffset = (currentPage - 1) * PAGE_SIZE;
        const googlePage = allGooglePlaces.slice(googleOffset, googleOffset + PAGE_SIZE);
        const combined = [...dbResults, ...googlePage];

        let filtered: any[];
        if (targetCategory === 'All') {
            filtered = combined;
        } else if (targetCategory === 'Community') {
            filtered = combined.filter(item => item.source === 'db');
        } else {
            filtered = combined.filter(item => item.category === targetCategory);
        }

        if (filtered.length === 0 && currentPage === 1) {
            return res.json({
                data: [{
                    id: 'debug-1',
                    name: `Sin resultados para ${targetCategory}`,
                    description: 'Intenta buscar una ciudad manualmente o muévete a otra zona.',
                    latitude: parseFloat(lat),
                    longitude: parseFloat(lon),
                    image_url: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5',
                    category: 'System',
                    source: 'db',
                    country: 'Tu Ubicación'
                }],
                nextGoogleToken: null
            });
        }

        const googleHasMore = googleOffset + PAGE_SIZE < allGooglePlaces.length;
        const dbHasMore = dbResults.length === PAGE_SIZE;

        res.json({
            data: filtered,
            nextGoogleToken: (googleHasMore || dbHasMore) ? 'more' : null
        });
    } catch (error) {
        console.error('Error Híbrido:', error);
        res.status(500).json({ error: 'Error obteniendo lugares' });
    }
};

// ==========================================
// 2. SUGERIR / GUARDAR (POST /suggest)
// ==========================================
export const suggestLocation = async (req: Request, res: Response) => {
    const { name, description, latitude, longitude, image_url, user_id, google_place_id, category, location_text } = req.body as {
        name?: string;
        description?: string;
        latitude?: number;
        longitude?: number;
        image_url?: string;
        user_id?: number;
        google_place_id?: string;
        category?: string;
        location_text?: string;
    };

    try {
        if (google_place_id) {
            const check = await db.raw('SELECT id FROM historical_locations WHERE google_place_id = ?', [google_place_id]);
            if (check.rows.length > 0) return res.status(400).json({ error: 'Ya registrado.' });
        }

        const finalCategory = category || 'Others';
        const finalLocationText = location_text || 'Unknown Location';
        const finalGoogleId = google_place_id || null;

        const newLoc = await db.raw(
            `INSERT INTO historical_locations
             (name, description, latitude, longitude, image_url, created_by_user_id, is_approved, google_place_id, category, location_text)
             VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)
             RETURNING *`,
            [name, description, latitude, longitude, image_url, user_id, finalGoogleId, finalCategory, finalLocationText]
        );

        res.json({ message: 'Lugar creado', location: newLoc.rows[0] });
    } catch (err) {
        const e = err as Error;
        console.error('Error al guardar:', e.message);
        res.status(500).json({ error: 'Error al guardar: ' + e.message });
    }
};

// ==========================================
// 3. BÚSQUEDA DE TEXTO (GET /external/search)
// ==========================================
const CATEGORY_SEARCH_TEXT: Record<string, string> = {
    'All':          'historical landmarks, museums, castles, monuments, churches, cathedrals',
    'Castles':      'Castles, palaces, fortresses, citadels',
    'Ruins':        'Ancient ruins, archaeological sites, historic ruins',
    'Museums':      'Museums, art galleries, history museums',
    'Historic Site':'Historical landmarks, heritage sites, cultural landmarks',
    'Religious':    'Churches, cathedrals, temples, synagogues, mosques',
};

export const getGoogleLocations = async (req: Request, res: Response) => {
    const lat      = typeof req.query.lat      === 'string' ? req.query.lat      : undefined;
    const lon      = typeof req.query.lon      === 'string' ? req.query.lon      : undefined;
    const q        = typeof req.query.q        === 'string' ? req.query.q        : undefined;
    const search   = typeof req.query.search   === 'string' ? req.query.search   : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const textQuery = q || search;
    const selectedCategory = category || 'All';

    if (!textQuery && !lat) return res.status(400).json({ error: 'Faltan datos' });

    try {
        const url = 'https://places.googleapis.com/v1/places:searchText';
        const categorySearchTerm = CATEGORY_SEARCH_TEXT[selectedCategory] || CATEGORY_SEARCH_TEXT['All'];
        const finalQuery = textQuery ? `${categorySearchTerm} in ${textQuery}` : categorySearchTerm;

        const requestBody: {
            textQuery: string;
            maxResultCount: number;
            locationBias?: { circle: { center: { latitude: number; longitude: number }; radius: number } };
        } = { textQuery: finalQuery, maxResultCount: 20 };

        if (lat && lon) {
            requestBody.locationBias = {
                circle: { center: { latitude: parseFloat(lat), longitude: parseFloat(lon) }, radius: 20000.0 }
            };
        }

        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.photos,places.types,places.primaryType'
        };

        const response = await axios.post(url, requestBody, { headers });
        const googlePlaces: any[] = response.data.places || [];

        const enrichedData = await Promise.all(googlePlaces.map(async (p: any) => {
            const pLat: number = p.location.latitude;
            const pLon: number = p.location.longitude;
            const pName: string = p.displayName?.text;

            if (isInvalidContext(pName)) return null;

            let finalDesc: string = p.formattedAddress;
            let finalImage: string | null = p.photos?.[0]
                ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?key=${GOOGLE_API_KEY}&maxHeightPx=600&maxWidthPx=600`
                : null;
            let imageSource: string | null = finalImage ? 'google' : null;
            let wikiTitle: string | null = null;

            const countryCode = extractCountryCode(p.addressComponents);
            const wikiData = await getWikipediaByName(pName, countryCode);
            if (wikiData) {
                if (wikiData.description) finalDesc = wikiData.description;
                if (!finalImage && wikiData.imageUrl) {
                    finalImage = wikiData.imageUrl;
                    imageSource = 'wikipedia';
                }
                wikiTitle = wikiData.title;
            }

            let shortAddress: string = p.formattedAddress;
            if (shortAddress && shortAddress.split(',').length >= 2) {
                shortAddress = shortAddress.split(',').slice(-2).join(',').trim();
            }

            const detectedCat = detectCategory(p.primaryType, p.types, pName);

            return {
                id: p.id, name: pName, description: finalDesc, latitude: pLat, longitude: pLon,
                image_url: finalImage,
                image_source: imageSource,
                category: detectedCat,
                source: 'google',
                google_place_id: p.id,
                address: p.formattedAddress,
                country: shortAddress,
                country_code: countryCode,
                wiki_title: wikiTitle
            };
        }));

        res.json({ data: enrichedData.filter((i): i is NonNullable<typeof i> => i !== null) });
    } catch (error) {
        res.status(500).json({ error: 'Error búsqueda externa' });
    }
};

// ==========================================
// 4. WIKIPEDIA DETALLE (RESUMEN + LINK)
// ==========================================
export const getWikiFullDetails = async (req: Request, res: Response) => {
    const title        = typeof req.query.title        === 'string' ? req.query.title        : undefined;
    const country_code = typeof req.query.country_code === 'string' ? req.query.country_code : undefined;

    if (!title || title === 'null') return res.status(400).json({ error: 'Título inválido' });

    try {
        const article = await resolveWikipediaArticleForCountry(title, country_code);

        if (!article || isInvalidContext(article.extract)) {
            return res.status(404).json({ error: 'No encontrado' });
        }

        res.json({ full_description: article.extract, wiki_url: article.wikiUrl });
    } catch (error) {
        const e = error as Error;
        console.error('Wiki Error Backend:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
// 5. ADMIN
// ==========================================
export const getPendingLocations = async (req: Request, res: Response) => {
    try {
        const r = await db.raw('SELECT * FROM historical_locations WHERE is_approved = FALSE');
        res.json(r.rows);
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const approveLocation = async (req: Request, res: Response) => {
    try {
        await db.raw('UPDATE historical_locations SET is_approved = TRUE WHERE id = ?', [req.params.id]);
        res.json({ msg: 'OK' });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const rejectLocation = async (req: Request, res: Response) => {
    try {
        await db.raw('DELETE FROM historical_locations WHERE id = ?', [req.params.id]);
        res.json({ msg: 'Deleted' });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};
