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
  setupContributionsTable,
  getMyDiscoveries
} from '../controller/contributionController.js';
import { verifyToken } from '../middleware/auth.js';
import {
    setupConquestsTable,
    conquerPlace,
    getMyConquests,
    checkConquest,
    getMyRank,
} from '../controller/conquestController.js';
import {
    setupFriendshipsTables,
    getMyUsername, checkUsername, updateUsername,
    searchUsers,
    sendFriendRequest, getMyFriends, getPendingRequests,
    respondToRequest, removeFriend, getFriendConquests,
} from '../controller/friendshipController.js';

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

// GET /api/contributions/my-discoveries -- lugares creados + aportes del usuario
router.get('/contributions/my-discoveries', verifyToken, getMyDiscoveries);

// Admin: ver pendientes / aprobar / rechazar
router.get('/admin/contributions/pending', getPendingContributions);
router.put('/admin/contributions/approve/:id', approveContribution);
router.delete('/admin/contributions/reject/:id', rejectContribution);

// Setup de la tabla en producción (una sola vez, no hay knex migrate en el deploy)
router.get('/setup-contributions-table', setupContributionsTable);

// ==========================================
// ⚔️ CONQUISTAS
// ==========================================
router.get('/setup-conquests-table', setupConquestsTable);
router.get('/setup-friendships-table', setupFriendshipsTables);
router.post('/conquests', verifyToken, conquerPlace);
router.get('/conquests/mine', verifyToken, getMyConquests);
router.get('/conquests/check', verifyToken, checkConquest);
router.get('/conquests/rank', verifyToken, getMyRank);

// ==========================================
// 👤 USERNAME
// ==========================================
router.get('/username', verifyToken, getMyUsername);
router.get('/username/check', verifyToken, checkUsername);
router.put('/username', verifyToken, updateUsername);

// ==========================================
// 🤝 FRIENDS
// ==========================================
router.get('/friends', verifyToken, getMyFriends);
router.get('/friends/search', verifyToken, searchUsers);
router.get('/friends/requests', verifyToken, getPendingRequests);
router.post('/friends/request', verifyToken, sendFriendRequest);
router.put('/friends/request/:id', verifyToken, respondToRequest);
router.delete('/friends/:id', verifyToken, removeFriend);
router.get('/friends/:userId/conquests', verifyToken, getFriendConquests);


// ==========================================
// 🔧 FIX DE ESQUEMA (una sola vez): columnas faltantes en historical_locations
// ==========================================
// Confirmado via /debug-schema (ya sacado): la tabla en producción tiene
// exactamente las columnas de la migración trackeada (id, name, category,
// description, country, image_url, images, geom, author, license,
// timestamps) -- pero suggestLocation, fetchFromDatabase y el resto de la
// moderación de historical_locations dan por sentado que además existen
// latitude, longitude, created_by_user_id, is_approved, google_place_id y
// location_text. Nunca se crearon: por eso "sugerir lugar" tira el error
// crudo de Postgres, y por eso el feed de "Community" siempre viene vacío
// (fetchFromDatabase atrapa el mismo error y devuelve [] en silencio).
// ADD COLUMN IF NOT EXISTS es aditivo/idempotente, no toca filas existentes.
router.get('/fix-historical-locations-schema', async (req, res) => {
    try {
        await db.raw(`
            ALTER TABLE historical_locations
                ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS google_place_id TEXT,
                ADD COLUMN IF NOT EXISTS location_text TEXT
        `);
        res.send('✅ LISTO: columnas latitude/longitude/created_by_user_id/is_approved/google_place_id/location_text agregadas (o ya existían).');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error agregando columnas: ' + e.message);
    }
});


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



export default router;