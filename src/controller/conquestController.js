import db from '../config/db.js';

// ─── Haversine: distancia en metros entre dos puntos GPS ──────────────────────
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Rango medieval según número de conquistas ────────────────────────────────
export function getRank(count) {
    if (count >= 100) return { title: 'High King',  emoji: '👑', next: null,  nextCount: null };
    if (count >= 50)  return { title: 'Duke',       emoji: '🏰', next: 'High King', nextCount: 100 };
    if (count >= 30)  return { title: 'Count',      emoji: '⚔️', next: 'Duke',     nextCount: 50 };
    if (count >= 15)  return { title: 'Baron',      emoji: '🛡️', next: 'Count',    nextCount: 30 };
    if (count >= 5)   return { title: 'Knight',     emoji: '⚔️', next: 'Baron',    nextCount: 15 };
    if (count >= 1)   return { title: 'Squire',     emoji: '🗡️', next: 'Knight',   nextCount: 5 };
    return               { title: 'Peasant',    emoji: '🌾', next: 'Squire',   nextCount: 1 };
}

// ─── 1. Setup tabla (idempotente, llámalo una vez en producción) ──────────────
export const setupConquestsTable = async (req, res) => {
    try {
        await db.raw(`
            CREATE TABLE IF NOT EXISTS conquests (
                id               serial PRIMARY KEY,
                user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                google_place_id  text    NULL,
                location_id      integer NULL REFERENCES historical_locations(id) ON DELETE CASCADE,
                place_name       text    NOT NULL DEFAULT '',
                place_lat        double precision NOT NULL,
                place_lon        double precision NOT NULL,
                user_lat         double precision NOT NULL,
                user_lon         double precision NOT NULL,
                image_url        text    NULL,
                category         text    NULL,
                conquered_at     timestamptz NOT NULL DEFAULT now(),
                UNIQUE (user_id, google_place_id),
                UNIQUE (user_id, location_id)
            )
        `);
        res.send('✅ tabla conquests creada (o ya existía).');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error: ' + e.message);
    }
};

// ─── 2. Conquistar un lugar ────────────────────────────────────────────────────
// Valida que el usuario esté a ≤150m del lugar antes de guardar.
export const conquerPlace = async (req, res) => {
    const userId = req.userId;
    const {
        google_place_id, location_id,
        place_name, place_lat, place_lon,
        user_lat, user_lon,
        image_url, category
    } = req.body;

    if (!place_lat || !place_lon || !user_lat || !user_lon) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }
    if (!google_place_id && !location_id) {
        return res.status(400).json({ error: 'Missing google_place_id or location_id' });
    }

    const dist = distanceMeters(
        parseFloat(user_lat), parseFloat(user_lon),
        parseFloat(place_lat), parseFloat(place_lon)
    );

    if (dist > 150) {
        return res.status(403).json({
            error: 'too_far',
            message: `You are ${Math.round(dist)}m away. You must be within 150m to conquer this place.`,
            distance: Math.round(dist)
        });
    }

    try {
        // Upsert — si ya existe, actualiza la fecha (re-conquista)
        const placeIdCol  = google_place_id ? 'google_place_id' : 'location_id';
        const placeIdVal  = google_place_id || location_id;

        const existing = await db.raw(
            `SELECT id FROM conquests WHERE user_id = ? AND ${placeIdCol} = ?`,
            [userId, placeIdVal]
        );

        let conquest;
        if (existing.rows.length > 0) {
            const updated = await db.raw(
                `UPDATE conquests SET conquered_at = now(), user_lat = ?, user_lon = ?
                 WHERE user_id = ? AND ${placeIdCol} = ? RETURNING *`,
                [user_lat, user_lon, userId, placeIdVal]
            );
            conquest = updated.rows[0];
        } else {
            const inserted = await db.raw(
                `INSERT INTO conquests
                 (user_id, google_place_id, location_id, place_name, place_lat, place_lon,
                  user_lat, user_lon, image_url, category)
                 VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
                [
                    userId,
                    google_place_id || null,
                    location_id || null,
                    place_name || '',
                    place_lat, place_lon,
                    user_lat, user_lon,
                    image_url || null,
                    category || null
                ]
            );
            conquest = inserted.rows[0];
        }

        // Devuelve también el rango actualizado
        const countResult = await db.raw(
            'SELECT COUNT(*)::int AS total FROM conquests WHERE user_id = ?', [userId]
        );
        const total = countResult.rows[0].total;

        res.json({ conquest, total, rank: getRank(total) });
    } catch (e) {
        console.error('conquerPlace error:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── 3. Mis conquistas ────────────────────────────────────────────────────────
export const getMyConquests = async (req, res) => {
    try {
        const result = await db.raw(
            `SELECT * FROM conquests WHERE user_id = ? ORDER BY conquered_at DESC`,
            [req.userId]
        );
        const total = result.rows.length;
        res.json({ conquests: result.rows, total, rank: getRank(total) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── 4. Verificar si ya conquisté un lugar ───────────────────────────────────
export const checkConquest = async (req, res) => {
    const { google_place_id, location_id } = req.query;
    const col = google_place_id ? 'google_place_id' : 'location_id';
    const val = google_place_id || location_id;
    if (!val) return res.status(400).json({ error: 'Missing id' });

    try {
        const r = await db.raw(
            `SELECT id, conquered_at FROM conquests WHERE user_id = ? AND ${col} = ? LIMIT 1`,
            [req.userId, val]
        );
        res.json({ conquered: r.rows.length > 0, conquest: r.rows[0] || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── 5. Mi perfil (count + rank) ─────────────────────────────────────────────
export const getMyRank = async (req, res) => {
    try {
        const r = await db.raw(
            'SELECT COUNT(*)::int AS total FROM conquests WHERE user_id = ?', [req.userId]
        );
        const total = r.rows[0].total;
        res.json({ total, rank: getRank(total) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
