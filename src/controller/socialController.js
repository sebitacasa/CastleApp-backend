import db from '../config/db.js';

// ==========================================
// 1. 🔍 BUSCADOR DE AMIGOS
// ==========================================
export const searchUsers = async (req, res) => {
    const { q } = req.query;
    const myId = 1; // ⚠️ ID FIJO TEMPORAL

    if (!q) return res.json([]);

    try {
        const users = await db('users')
            .where('username', 'ilike', `%${q}%`)
            .andWhereNot('id', myId)
            .select('id', 'username', 'avatar_url')
            .limit(10);
        
        const myFollows = await db('follows')
            .where('follower_id', myId)
            .pluck('following_id');

        const results = users.map(user => ({
            ...user,
            isFollowing: myFollows.includes(user.id)
        }));

        res.json(results);
    } catch (error) {
        console.error("Error buscando usuarios:", error);
        res.status(500).json({ error: 'Error buscando usuarios' });
    }
};

// ==========================================
// 2. ➕ SEGUIR A ALGUIEN
// ==========================================
export const followUser = async (req, res) => {
    const follower_id = 1; // ⚠️ ID FIJO TEMPORAL
    const following_id = req.params.id;

    if (follower_id == following_id) {
        return res.status(400).json({ error: "No puedes seguirte a ti mismo" });
    }

    try {
        await db('follows').insert({ follower_id, following_id });
        res.json({ success: true, message: 'Usuario seguido correctamente' });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Ya sigues a este usuario' });
        }
        res.status(500).json({ error: 'Error al seguir usuario' });
    }
};

// ==========================================
// 3. ➖ DEJAR DE SEGUIR
// ==========================================
export const unfollowUser = async (req, res) => {
    const follower_id = 1; // ⚠️ ID FIJO TEMPORAL
    const following_id = req.params.id;

    try {
        await db('follows')
            .where({ follower_id, following_id })
            .del();
        res.json({ success: true, message: 'Has dejado de seguir al usuario' });
    } catch (error) {
        res.status(500).json({ error: 'Error al dejar de seguir' });
    }
};

// ==========================================
// 4. ✅ MARCAR LUGAR VISITADO (CHECK-IN)
// ==========================================
export const registerVisit = async (req, res) => {
    const user_id = 1; // ⚠️ ID FIJO TEMPORAL
    const location_id = req.params.locationId;

    try {
        const exists = await db('visited_places')
            .where({ user_id, location_id })
            .first();

        if (!exists) {
            await db('visited_places').insert({ 
                user_id, 
                location_id,
                visited_at: db.fn.now()
            });
            res.json({ success: true, message: '¡Lugar visitado!' });
        } else {
            res.json({ success: true, message: 'Ya habías visitado este lugar' });
        }
    } catch (error) {
        console.error("Error marcando visita:", error);
        res.status(500).json({ error: 'Error al marcar visita' });
    }
};

// ==========================================
// 5. 🌎 FEED SOCIAL (Actividad de Amigos)
// ==========================================
export const getSocialFeed = async (req, res) => {
    const myId = 1; // ⚠️ ID FIJO TEMPORAL

    try {
        const feed = await db('visited_places as vp')
            .join('users as u', 'vp.user_id', 'u.id')
            .join('follows as f', 'f.following_id', 'u.id')
            .join('historical_locations as l', 'vp.location_id', 'l.id')
            .where('f.follower_id', myId)
            .select(
                'l.id as location_id',
                'l.name as location_name',
                'l.image_url',
                'l.category',
                'l.country',
                'u.username as friend_name',
                'u.avatar_url as friend_avatar',
                'vp.visited_at'
            )
            .orderBy('vp.visited_at', 'desc')
            .limit(20);

        res.json(feed);
    } catch (error) {
        console.error("Error cargando feed:", error);
        res.status(500).json({ error: 'Error cargando feed' });
    }
};

// ==========================================
// 6. 🗺️ MIS VISITAS (Para el Mapa)
// ==========================================
export const getMyVisits = async (req, res) => {
    const myId = 1; // ⚠️ ID FIJO TEMPORAL
    try {
        const places = await db('visited_places as vp')
            .join('historical_locations as l', 'vp.location_id', 'l.id')
            .where('vp.user_id', myId)
            .select('l.id', 'l.name', 'l.category', 'l.country', 'l.image_url', db.raw('ST_X(l.geom) as lon'), db.raw('ST_Y(l.geom) as lat'));
        res.json(places);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error cargando mis visitas' });
    }
};

// ==========================================
// 7. 🗺️ VISITAS DE AMIGO (Para el VS)
// ==========================================
export const getFriendVisits = async (req, res) => {
    const userId = req.params.id;
    try {
        const places = await db('visited_places as vp')
            .join('historical_locations as l', 'vp.location_id', 'l.id')
            .where('vp.user_id', userId)
            .select('l.id', 'l.name', 'l.category', 'l.country', 'l.image_url', db.raw('ST_X(l.geom) as lon'), db.raw('ST_Y(l.geom) as lat'));
        res.json(places);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error cargando visitas del amigo' });
    }
};