// ==========================================
// UTILIDADES GEOGRÁFICAS Y CONSTANTES
// ==========================================

export const DENSE_CITIES = [
    'tokyo', 'osaka', 'seoul', 'beijing', 'shanghai', 'hong kong', 'bangkok', 'delhi', 'mumbai',
    'london', 'londres', 'paris', 'rome', 'roma', 'berlin', 'madrid', 'barcelona', 'amsterdam', 
    'venice', 'venecia', 'prague', 'vienna', 'budapest', 'istanbul', 'moscow',
    'new york', 'nueva york', 'san francisco', 'los angeles', 'mexico city', 'cdmx', 'sao paulo', 
    'buenos aires', 'rio de janeiro', 'bogota', 'lima', 'santiago', 'cairo', 'sydney'
];

export function getBoundingBox(lat, lon, zoomLevel) {
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