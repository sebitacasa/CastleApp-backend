import { Request, Response } from 'express';
import db from '../config/db.js';

interface PlaceFilter {
    column: string;
    value: string | number;
}

const placeFilter = (
    googlePlaceId: string | undefined,
    locationId: string | undefined
): PlaceFilter | null => {
    if (googlePlaceId) return { column: 'google_place_id', value: googlePlaceId };
    if (locationId)    return { column: 'location_id',     value: locationId };
    return null;
};

// ==========================================
// 1. SUBIR APORTE -- requiere login
// ==========================================
export const submitContribution = async (req: Request, res: Response) => {
    const { google_place_id, location_id, photo_url, info_text } = req.body as {
        google_place_id?: string;
        location_id?: string;
        photo_url?: string;
        info_text?: string;
    };
    const userId = req.userId;

    if (!google_place_id && !location_id) {
        return res.status(400).json({ error: 'Falta google_place_id o location_id' });
    }
    if (!photo_url && !info_text) {
        return res.status(400).json({ error: 'Falta photo_url o info_text' });
    }

    try {
        if (photo_url) {
            const filter = placeFilter(google_place_id, location_id)!;
            const existingPhoto = await db.raw(
                `SELECT id FROM location_contributions WHERE ${filter.column} = ? AND is_approved = TRUE AND photo_url IS NOT NULL LIMIT 1`,
                [filter.value]
            );
            if (existingPhoto.rows.length > 0) {
                return res.status(400).json({ error: 'Este lugar ya tiene una foto de la comunidad aprobada' });
            }
        }

        const inserted = await db.raw(
            `INSERT INTO location_contributions (google_place_id, location_id, user_id, photo_url, info_text)
             VALUES (?, ?, ?, ?, ?) RETURNING *`,
            [google_place_id || null, location_id || null, userId, photo_url || null, info_text || null]
        );

        res.json({ message: 'Aporte enviado para revisión', contribution: inserted.rows[0] });
    } catch (e) {
        const err = e as Error;
        console.error('Error en submitContribution:', err.message);
        res.status(500).json({ error: 'Error al guardar el aporte' });
    }
};

// ==========================================
// 2. VER APORTE APROBADO DE UN LUGAR (público)
// ==========================================
export const getContributionForPlace = async (req: Request, res: Response) => {
    const { google_place_id, location_id } = req.query as { google_place_id?: string; location_id?: string };
    const filter = placeFilter(google_place_id, location_id);
    if (!filter) return res.status(400).json({ error: 'Falta google_place_id o location_id' });

    try {
        const result = await db.raw(
            `SELECT * FROM location_contributions WHERE ${filter.column} = ? AND is_approved = TRUE ORDER BY created_at DESC LIMIT 1`,
            [filter.value]
        );
        res.json({ contribution: result.rows[0] || null });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. VER MI PROPIO APORTE PARA UN LUGAR (requiere login)
// ==========================================
export const getMyContribution = async (req: Request, res: Response) => {
    const { google_place_id, location_id } = req.query as { google_place_id?: string; location_id?: string };
    const filter = placeFilter(google_place_id, location_id);
    if (!filter) return res.status(400).json({ error: 'Falta google_place_id o location_id' });

    try {
        const result = await db.raw(
            `SELECT * FROM location_contributions WHERE ${filter.column} = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
            [filter.value, req.userId]
        );
        res.json({ contribution: result.rows[0] || null });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4. TODOS MIS APORTES + MIS LUGARES CREADOS (requiere login)
// ==========================================
export const getMyDiscoveries = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;

        const placesResult = await db.raw(
            `SELECT id, name, description, image_url, category, latitude, longitude, created_at
             FROM historical_locations
             WHERE created_by_user_id = ?
             ORDER BY created_at DESC`,
            [userId]
        );

        const contribsResult = await db.raw(
            `SELECT lc.id, lc.photo_url, lc.info_text, lc.is_approved, lc.created_at,
                    lc.google_place_id, lc.location_id,
                    hl.name AS place_name
             FROM location_contributions lc
             LEFT JOIN historical_locations hl ON hl.id = lc.location_id
             WHERE lc.user_id = ?
             ORDER BY lc.created_at DESC`,
            [userId]
        );

        res.json({
            places: placesResult.rows,
            contributions: contribsResult.rows,
        });
    } catch (e) {
        const err = e as Error;
        console.error('Error en getMyDiscoveries:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 5. ADMIN
// ==========================================
export const getPendingContributions = async (req: Request, res: Response) => {
    try {
        const r = await db.raw('SELECT * FROM location_contributions WHERE is_approved = FALSE ORDER BY created_at DESC');
        res.json(r.rows);
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const approveContribution = async (req: Request, res: Response) => {
    try {
        await db.raw('UPDATE location_contributions SET is_approved = TRUE, updated_at = now() WHERE id = ?', [req.params.id]);
        res.json({ msg: 'OK' });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const rejectContribution = async (req: Request, res: Response) => {
    try {
        await db.raw('DELETE FROM location_contributions WHERE id = ?', [req.params.id]);
        res.json({ msg: 'Deleted' });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};
