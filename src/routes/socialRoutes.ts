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

const router = Router();

// RUTAS SOCIALES
router.get('/search', searchUsers);
router.post('/follow/:id', followUser);
router.delete('/unfollow/:id', unfollowUser);
router.get('/feed', getSocialFeed);

// RUTAS DE VISITAS (CHECK-IN & MAPA)
router.post('/visit/:locationId', registerVisit);
router.get('/visits/me', getMyVisits);
router.get('/visits/user/:id', getFriendVisits);

export default router;
