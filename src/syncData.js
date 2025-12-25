import { Pool } from 'pg';
import fetch from 'node-fetch'; 

// Configuración unificada con tu knexfile
const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1', 
  database: 'castle_db', // Asegúrate de que coincida con tu .env
  password: 'test_password_123',
  port: 5432, 
});

const EUROPEANA_API_KEY = 'ivediese'; 
// Filtramos por España y por el término Castillo
const SEARCH_QUERY = 'castle AND country:spain'; 
const API_URL = `https://api.europeana.eu/record/v2/search.json?wskey=${EUROPEANA_API_KEY}&query=${SEARCH_QUERY}&rows=50`;

async function syncData() {
  console.log("📡 Conectando con Europeana para obtener datos de España...");
  let client;

  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    const items = data.items || [];
    
    
    // Filtramos solo los que tienen coordenadas para PostGIS
    const geoItems = items.filter(item => item.edmPlaceLatitude && item.edmPlaceLongitude);

    client = await pool.connect();

    const promises = geoItems.map(async item => {
      const lat = item.edmPlaceLatitude[0];
      const lon = item.edmPlaceLongitude[0];
      
      const upsertQuery = `
        INSERT INTO localizaciones (name, description, category, image_url, geom)
        VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))
        ON CONFLICT (name) DO NOTHING; 
      `;
      
      const values = [
        item.title[0],
        item.dcDescription ? item.dcDescription[0].substring(0, 200) : 'Monumento histórico',
        'Castillo',
        item.edmPreview ? item.edmPreview[0] : null,
        lon, 
        lat
      ];

      return client.query(upsertQuery, values);
    });

    await Promise.all(promises);
    console.log(`✅ ¡Éxito! Se han guardado ${geoItems.length} castillos en tu base de datos.`);

  } catch (error) {
    console.error('❌ Error en el proceso:', error);
  } finally {
    if (client) client.release();
    process.exit();
  }
}

syncData();