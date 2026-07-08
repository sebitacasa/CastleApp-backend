import { Router } from 'express';

import {
    getGoogleLocations,
    getWikiFullDetails,
    getLocations,
    suggestLocation,
    getPendingLocations,
    approveLocation,
    rejectLocation
} from '../controller/googleLocationController.js';

import { getProxyImage } from '../controller/europeanaController.js';

import {
    submitContribution,
    getContributionForPlace,
    getMyContribution,
    getPendingContributions,
    approveContribution,
    rejectContribution,
    getMyDiscoveries
} from '../controller/contributionController.js';

import { verifyToken } from '../middleware/auth.js';

import {
    conquerPlace,
    getMyConquests,
    checkConquest,
    getMyRank,
} from '../controller/conquestController.js';

import {
    updatePushToken,
    getMyUsername,
    checkUsername,
    updateUsername,
    searchUsers,
    sendFriendRequest,
    getMyFriends,
    getPendingRequests,
    respondToRequest,
    removeFriend,
    getFriendConquests,
} from '../controller/friendshipController.js';

const router = Router();

// ==========================================
// ZONA 1: EL MAPA PRINCIPAL (Híbrido)
// ==========================================
router.get('/', getLocations);

// ==========================================
// ZONA 2: GUARDAR HALLAZGOS
// ==========================================
router.post('/suggest', suggestLocation);

// ==========================================
// ZONA 3: EL BUSCADOR (SearchScreen)
// ==========================================
router.get('/external/search', getGoogleLocations);
router.get('/external/wiki', getWikiFullDetails);
router.get('/image-proxy', getProxyImage);

// ==========================================
// ZONA 4: ADMINISTRACIÓN (Moderación)
// ==========================================
router.get('/admin/pending', getPendingLocations);
router.put('/admin/approve/:id', approveLocation);
router.delete('/admin/reject/:id', rejectLocation);

// ==========================================
// ZONA 5: APORTES DE LA COMUNIDAD (Detail)
// ==========================================
router.post('/contributions', verifyToken, submitContribution);
router.get('/contributions', getContributionForPlace);
router.get('/contributions/mine', verifyToken, getMyContribution);
router.get('/contributions/my-discoveries', verifyToken, getMyDiscoveries);

router.get('/admin/contributions/pending', getPendingContributions);
router.put('/admin/contributions/approve/:id', approveContribution);
router.delete('/admin/contributions/reject/:id', rejectContribution);

// ==========================================
// CONQUISTAS
// ==========================================
router.put('/push-token', verifyToken, updatePushToken);
router.post('/conquests', verifyToken, conquerPlace);
router.get('/conquests/mine', verifyToken, getMyConquests);
router.get('/conquests/check', verifyToken, checkConquest);
router.get('/conquests/rank', verifyToken, getMyRank);

// ==========================================
// USERNAME
// ==========================================
router.get('/username', verifyToken, getMyUsername);
router.get('/username/check', verifyToken, checkUsername);
router.put('/username', verifyToken, updateUsername);

// ==========================================
// FRIENDS
// ==========================================
router.get('/friends', verifyToken, getMyFriends);
router.get('/friends/search', verifyToken, searchUsers);
router.get('/friends/requests', verifyToken, getPendingRequests);
router.post('/friends/request', verifyToken, sendFriendRequest);
router.put('/friends/request/:id', verifyToken, respondToRequest);
router.delete('/friends/:id', verifyToken, removeFriend);
router.get('/friends/:userId/conquests', verifyToken, getFriendConquests);

export default router;
