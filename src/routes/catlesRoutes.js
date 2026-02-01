import { Router } from 'express';

// 👇 CORRECCIÓN IMPORTANTE: 
// Apuntamos a '../db.js' (en la raíz de src) para arreglar el error de módulo no encontrado.
// Si tu archivo sigue en 'config/db.js', cambia esto a '../config/db.js'.
import { pool } from '../config/db.js'; 

// 1. CONTROLADOR INTERNO (Tu Base de Datos + Híbrido)
// Este controlador ahora es inteligente: mezcla tus datos con los de Google.
import { 
    getGoogleLocations, 
  getWikiFullDetails,
  getLocations,        // Mapa Híbrido (Google + Tu DB)
  suggestLocation,     // Guardar nuevo hallazgo
  getPendingLocations, // Admin: Ver pendientes
  approveLocation,     // Admin: Aprobar
  rejectLocation       // Admin: Rechazar
} from '../controller/googleLocationController.js'; 

// 2. CONTROLADOR EXTERNO (Búsqueda Manual)
// Este maneja la pantalla de búsqueda específica ("SearchScreen").

const router = Router();

// ==========================================
// 🗺️ ZONA 1: EL MAPA PRINCIPAL (Híbrido)
// ==========================================

// GET /api/locations?lat=...&lon=...
// Uso: FeedScreen y MapScreen.
// Acción: Devuelve una mezcla de lugares de Google (rojos) y tus lugares (dorados).
router.get('/', getLocations); 


// ==========================================
// 📥 ZONA 2: GUARDAR HALLAZGOS
// ==========================================

// POST /api/locations/suggest
// Uso: Botón "Sugerir" en la app.
// Acción: Guarda un lugar en TU base de datos como "Pendiente" (is_approved = false).
router.post('/suggest', suggestLocation); 


// ==========================================
// 🔭 ZONA 3: EL BUSCADOR (SearchScreen)
// ==========================================

// GET /api/locations/external/search?q=castillo&lat=...
// Uso: Pantalla de "Buscar Lugar Nuevo".
// Acción: Busca texto libre en Google Maps.
router.get('/external/search', getGoogleLocations);

// GET /api/locations/external/wiki?title=...
// Uso: Botón "Leer más" para traer info detallada.
router.get('/external/wiki', getWikiFullDetails);


// ==========================================
// 🛡️ ZONA 4: ADMINISTRACIÓN (Moderación)
// ==========================================

// Ver lista de pendientes
router.get('/admin/pending', getPendingLocations);

// Aprobar (Hacer visible un lugar)
router.put('/admin/approve/:id', approveLocation);

// Rechazar (Borrar de la base de datos)
router.delete('/admin/reject/:id', rejectLocation);


// ==========================================
// ☢️ ZONA DE PELIGRO (Utilidades)
// ==========================================

// Borrar toda la base de datos (¡CUIDADO!)
router.get('/nuke-db', async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE historical_locations CASCADE');
        res.send('✅ LISTO: Base de datos purgada. El mapa ha sido reiniciado.');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error purgado DB: ' + e.message);
    }
});

export default router;