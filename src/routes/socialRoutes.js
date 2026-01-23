import express from 'express';
// Importamos las funciones del controlador
import { 
    searchUsers, 
    followUser, 
    unfollowUser, 
    registerVisit, 
    getSocialFeed,
    getMyVisits,
    getFriendVisits
} from '../controller/socialController.js';

const router = express.Router();

// --- RUTAS SOCIALES ---
router.get('/search', searchUsers);           // Buscar amigos
router.post('/follow/:id', followUser);       // Seguir
router.delete('/unfollow/:id', unfollowUser); // Dejar de seguir
router.get('/feed', getSocialFeed);           // Ver actividad reciente

// --- RUTAS DE VISITAS (CHECK-IN & MAPA) ---
router.post('/visit/:locationId', registerVisit); // Marcar visitado
router.get('/visits/me', getMyVisits);            // Mis lugares (Mapa)
router.get('/visits/user/:id', getFriendVisits);  // Lugares de amigo (Mapa VS)

export default router;