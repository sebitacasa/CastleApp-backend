import { Router } from 'express';
import { pool } from '../config/db.js'; // Importamos la conexión para la utilidad de limpieza

// 1. CONTROLADOR INTERNO (Tu Propiedad)
// Maneja tu base de datos: lo que ya tienes guardado y lo que está pendiente de aprobación.
import { 
  getLocations,        // Trae tus castillos aprobados (para el Mapa Principal)
  suggestLocation,     // Guarda un nuevo hallazgo (El "Puente" de Google a tu DB)
  getPendingLocations, // Admin: Ver qué han subido
  approveLocation,     // Admin: Dar el visto bueno
  rejectLocation       // Admin: Borrar basura
} from '../controller/locationsController.js'; 

// 2. CONTROLADOR EXTERNO (El Explorador)
// Maneja las búsquedas en Google y Wikipedia. No guarda nada, solo "mira".
import { 
  getGoogleLocations, 
  getWikiFullDetails 
} from '../controller/googleLocationController.js';

const router = Router();

// ==========================================
// 🗺️ ZONA 1: TU MAPA (Lo que ya es tuyo)
// ==========================================

// GET /api/locations?lat=...&lon=...
// Uso: El Mapa Principal de la App.
// Acción: Muestra solo los lugares que YA están en tu base de datos y aprobados.
router.get('/', getLocations); 


// ==========================================
// 🌉 ZONA 2: EL PUENTE (Guardar Hallazgos)
// ==========================================

// POST /api/locations/suggest
// Uso: Botón "Sugerir Lugar" o "Reclamar Hallazgo".
// Acción: Recibe datos (ya sea de Google o manuales) y los guarda en TU base de datos como "Pendiente".
router.post('/suggest', suggestLocation); 


// ==========================================
// 🔭 ZONA 3: EL RADAR (Buscar fuera)
// ==========================================

// GET /api/locations/external/search?q=castillo&lat=...
// Uso: Pantalla de "Buscar Lugar Nuevo".
// Acción: Busca en Google Maps en tiempo real. Devuelve resultados con "source: google".
router.get('/external/search', getGoogleLocations);

// GET /api/locations/external/wiki?title=...
// Uso: Botón "Leer más" en la ficha de detalle.
router.get('/external/wiki', getWikiFullDetails);


// ==========================================
// 🛡️ ZONA 4: ADMINISTRACIÓN (Moderación)
// ==========================================

// Ver lista de pendientes (Para tu panel de admin)
router.get('/admin/pending', getPendingLocations);

// Aprobar un lugar (Pasa de invisible a visible en el mapa)
router.put('/admin/approve/:id', approveLocation);

// Rechazar un lugar (Se borra de la base de datos)
router.delete('/admin/reject/:id', rejectLocation);


// ==========================================
// ☢️ ZONA DE PELIGRO (Utilidades)
// ==========================================

// Borrar toda la base de datos (Solo para desarrollo)
router.get('/nuke-db', async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE historical_locations CASCADE');
        res.send('✅ LISTO: Base de datos purgada. El mapa debería estar vacío ahora.');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error purgado DB: ' + e.message);
    }
});

export default router;