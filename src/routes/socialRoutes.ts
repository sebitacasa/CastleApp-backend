import { Router } from 'express';
import {
    searchUsers,
    followUser,
    unfollowUser,
    registerVisit,
    getSocialFeed,
    getMyVisits,
    getFriendVisits
} from '../controller/socialController.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

// RUTAS SOCIALES — todas requieren usuario autenticado (req.userId)
router.get('/search', verifyToken, searchUsers);
router.post('/follow/:id', verifyToken, followUser);
router.delete('/unfollow/:id', verifyToken, unfollowUser);
router.get('/feed', verifyToken, getSocialFeed);

// RUTAS DE VISITAS (CHECK-IN & MAPA)
router.post('/visit/:locationId', verifyToken, registerVisit);
router.get('/visits/me', verifyToken, getMyVisits);
router.get('/visits/user/:id', verifyToken, getFriendVisits);

export default router;
