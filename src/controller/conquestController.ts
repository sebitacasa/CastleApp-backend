import { Request, Response } from 'express';
import db from '../config/db.js';

export interface Rank {
    title: string;
    emoji: string;
    next: string | null;
    nextCount: number | null;
}

// ─── Haversine: distancia en metros entre dos puntos GPS ──────────────────────
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Rango medieval según número de conquistas ────────────────────────────────
export function getRank(count: number): Rank {
    if (count >= 100) return { title: 'High King',  emoji: '👑', next: null,      nextCount: null };
    if (count >= 50)  return { title: 'Duke',       emoji: '🏰', next: 'High King', nextCount: 100 };
    if (count >= 30)  return { title: 'Count',      emoji: '⚔️', next: 'Duke',     nextCount: 50 };
    if (count >= 15)  return { title: 'Baron',      emoji: '🛡️', next: 'Count',    nextCount: 30 };
    if (count >= 5)   return { title: 'Knight',     emoji: '⚔️', next: 'Baron',    nextCount: 15 };
    if (count >= 1)   return { title: 'Squire',     emoji: '🗡️', next: 'Knight',   nextCount: 5 };
    return               { title: 'Peasant',    emoji: '🌾', next: 'Squire',   nextCount: 1 };
}

// ─── 1. Conquistar un lugar ────────────────────────────────────────────────────
export const conquerPlace = async (req: Request, res: Response) => {
    const userId = req.userId;
    const {
        google_place_id, location_id,
        place_name, place_lat, place_lon,
        user_lat, user_lon,
        image_url, category
    } = req.body as {
        google_place_id?: string;
        location_id?: number;
        place_name?: string;
        place_lat?: string | number;
        place_lon?: string | number;
        user_lat?: string | number;
        user_lon?: string | number;
        image_url?: string;
        category?: string;
    };

    if (!place_lat || !place_lon || !user_lat || !user_lon) {
        return res.status(400).json({ error: 'Missing coordinates' });
    }
    if (!google_place_id && !location_id) {
        return res.status(400).json({ error: 'Missing google_place_id or location_id' });
    }

    const dist = distanceMeters(
        parseFloat(String(user_lat)), parseFloat(String(user_lon)),
        parseFloat(String(place_lat)), parseFloat(String(place_lon))
    );

    if (dist > 150) {
        return res.status(403).json({
            error: 'too_far',
            message: `You are ${Math.round(dist)}m away. You must be within 150m to conquer this place.`,
            distance: Math.round(dist)
        });
    }

    try {
        const placeIdCol = google_place_id ? 'google_place_id' : 'location_id';
        const placeIdVal = google_place_id || location_id;

        const existing = await db.raw(
            `SELECT id FROM conquests WHERE user_id = ? AND ${placeIdCol} = ?`,
            [userId, placeIdVal]
        );

        let conquest: unknown;
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

        const countResult = await db.raw(
            'SELECT COUNT(*)::int AS total FROM conquests WHERE user_id = ?', [userId]
        );
        const total: number = countResult.rows[0].total;

        res.json({ conquest, total, rank: getRank(total) });
    } catch (e) {
        const err = e as Error;
        console.error('conquerPlace error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ─── 3. Mis conquistas ────────────────────────────────────────────────────────
export const getMyConquests = async (req: Request, res: Response) => {
    try {
        const result = await db.raw(
            `SELECT * FROM conquests WHERE user_id = ? ORDER BY conquered_at DESC`,
            [req.userId]
        );
        const total: number = result.rows.length;
        res.json({ conquests: result.rows, total, rank: getRank(total) });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ─── 4. Verificar si ya conquisté un lugar ───────────────────────────────────
export const checkConquest = async (req: Request, res: Response) => {
    const { google_place_id, location_id } = req.query as { google_place_id?: string; location_id?: string };
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
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ─── 5. Mi perfil (count + rank) ─────────────────────────────────────────────
export const getMyRank = async (req: Request, res: Response) => {
    try {
        const r = await db.raw(
            'SELECT COUNT(*)::int AS total FROM conquests WHERE user_id = ?', [req.userId]
        );
        const total: number = r.rows[0].total;
        res.json({ total, rank: getRank(total) });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};
