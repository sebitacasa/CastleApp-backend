import { Router } from 'express';

// 👇 CORRECCIÓN IMPORTANTE: 
// Apuntamos a '../db.js' (en la raíz de src) para arreglar el error de módulo no encontrado.
// Si tu archivo sigue en 'config/db.js', cambia esto a '../config/db.js'.
import db from '../config/db.js'; 

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

// 👇 image-proxy: se perdió al refactorizar a googleLocationController y el
// frontend (DetailScreen) sigue dependiendo de esta ruta para poder mostrar
// imagenes de wikimedia.org (Wikimedia bloquea el hotlinking directo).
import { getProxyImage } from '../controller/europeanaController.js';

// 3. APORTES DE LA COMUNIDAD (foto + info en el Detail, requiere login)
import {
  submitContribution,
  getContributionForPlace,
  getMyContribution,
  getPendingContributions,
  approveContribution,
  rejectContribution,
  setupContributionsTable
} from '../controller/contributionController.js';
import { verifyToken } from '../middleware/auth.js';

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

// GET /api/image-proxy?url=...
// Uso: DetailScreen -- reenvía imágenes de wikimedia.org con un User-Agent
// válido, porque Wikimedia bloquea el hotlinking directo desde la app.
router.get('/image-proxy', getProxyImage);


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
// 📸 ZONA 5: APORTES DE LA COMUNIDAD (Detail)
// ==========================================
// Un usuario logeado puede sumar una foto y/o un texto de info a un lugar
// existente (de Google o de la comunidad). Queda pendiente de aprobación
// hasta que se revise a mano (mismos endpoints admin sin UI que ya existen
// para historical_locations).

// POST /api/contributions -- requiere login (verifyToken setea req.userId)
router.post('/contributions', verifyToken, submitContribution);

// GET /api/contributions?google_place_id=...|location_id=... -- público
router.get('/contributions', getContributionForPlace);

// GET /api/contributions/mine?google_place_id=...|location_id=... -- requiere login
router.get('/contributions/mine', verifyToken, getMyContribution);

// Admin: ver pendientes / aprobar / rechazar
router.get('/admin/contributions/pending', getPendingContributions);
router.put('/admin/contributions/approve/:id', approveContribution);
router.delete('/admin/contributions/reject/:id', rejectContribution);

// Setup de la tabla en producción (una sola vez, no hay knex migrate en el deploy)
router.get('/setup-contributions-table', setupContributionsTable);


// ==========================================
// ☢️ ZONA DE PELIGRO (Utilidades)
// ==========================================

// Borrar toda la base de datos (¡CUIDADO!)
router.get('/nuke-db', async (req, res) => {
    try {
        await db.raw('TRUNCATE TABLE historical_locations CASCADE');
        res.send('✅ LISTO: Base de datos purgada. El mapa ha sido reiniciado.');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error purgado DB: ' + e.message);
    }
});

// ... (resto del archivo arriba)

// ==========================================
// 🔧 HERRAMIENTA DE REPARACIÓN (Fix DB)
// ==========================================
// Ejecuta esto una sola vez para arreglar los nombres de las columnas
// router.get('/fix-db-schema', async (req, res) => {
//     try {
//         // 1. Intentamos renombrar 'lat' a 'latitude'
//         // (Si falla es porque ya se llama latitude o no existe, entonces pasamos al catch)
//         await db.raw('ALTER TABLE historical_locations RENAME COLUMN lat TO latitude');
//         await db.raw('ALTER TABLE historical_locations RENAME COLUMN lon TO longitude');
        
//         res.send("✅ ÉXITO: Las columnas han sido renombradas de 'lat/lon' a 'latitude/longitude'. Ahora el mapa funcionará.");
//     } catch (error) {
//         // 2. Si falla lo anterior, intentamos ver si es que faltan
//         try {
//             // Solo las crea si no existen
//             await db.raw('ALTER TABLE historical_locations ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION');
//             await db.raw('ALTER TABLE historical_locations ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION');
//             res.send("⚠️ AVISO: No se encontraron 'lat/lon', así que se crearon columnas nuevas 'latitude/longitude'.");
//         } catch (e2) {
//             res.status(500).send("❌ ERROR CRÍTICO: " + error.message + " | " + e2.message);
//         }
//     }
// });



export default router;