import db from '../config/db.js';

// ==========================================
// 🛠️ SETUP (una sola vez, no hay knex migrate corriendo en el deploy)
// ==========================================
// Mismo patrón que /nuke-db y el /fix-db-schema comentado en catlesRoutes.js:
// una ruta GET idempotente que corre DDL cruda, porque no hay credenciales de
// DB disponibles para correr una migración de knex contra producción.
export const setupContributionsTable = async (req, res) => {
    try {
        await db.raw(`
            CREATE TABLE IF NOT EXISTS location_contributions (
                id serial PRIMARY KEY,
                google_place_id text NULL,
                location_id integer NULL REFERENCES historical_locations(id) ON DELETE CASCADE,
                user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                photo_url text NULL,
                info_text text NULL,
                is_approved boolean NOT NULL DEFAULT false,
                created_at timestamptz DEFAULT now(),
                updated_at timestamptz DEFAULT now()
            )
        `);
        res.send('✅ LISTO: tabla location_contributions creada (o ya existía).');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error creando location_contributions: ' + e.message);
    }
};

// Arma el WHERE por google_place_id o location_id según lo que venga.
const placeFilter = (googlePlaceId, locationId) => {
    if (googlePlaceId) return { column: 'google_place_id', value: googlePlaceId };
    if (locationId) return { column: 'location_id', value: locationId };
    return null;
};

// ==========================================
// 📥 1. SUBIR APORTE (foto y/o info) -- requiere login
// ==========================================
export const submitContribution = async (req, res) => {
    const { google_place_id, location_id, photo_url, info_text } = req.body;
    const userId = req.userId;

    if (!google_place_id && !location_id) {
        return res.status(400).json({ error: 'Falta google_place_id o location_id' });
    }
    if (!photo_url && !info_text) {
        return res.status(400).json({ error: 'Falta photo_url o info_text' });
    }

    try {
        if (photo_url) {
            const filter = placeFilter(google_place_id, location_id);
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
        console.error('Error en submitContribution:', e.message);
        res.status(500).json({ error: 'Error al guardar el aporte' });
    }
};

// ==========================================
// 🔎 2. VER APORTE APROBADO DE UN LUGAR (público)
// ==========================================
export const getContributionForPlace = async (req, res) => {
    const { google_place_id, location_id } = req.query;
    const filter = placeFilter(google_place_id, location_id);
    if (!filter) return res.status(400).json({ error: 'Falta google_place_id o location_id' });

    try {
        const result = await db.raw(
            `SELECT * FROM location_contributions WHERE ${filter.column} = ? AND is_approved = TRUE ORDER BY created_at DESC LIMIT 1`,
            [filter.value]
        );
        res.json({ contribution: result.rows[0] || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
// 🔎 3. VER MI PROPIO APORTE PARA UN LUGAR (requiere login)
// ==========================================
export const getMyContribution = async (req, res) => {
    const { google_place_id, location_id } = req.query;
    const filter = placeFilter(google_place_id, location_id);
    if (!filter) return res.status(400).json({ error: 'Falta google_place_id o location_id' });

    try {
        const result = await db.raw(
            `SELECT * FROM location_contributions WHERE ${filter.column} = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`,
            [filter.value, req.userId]
        );
        res.json({ contribution: result.rows[0] || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
// 🔎 4. TODOS MIS APORTES + MIS LUGARES CREADOS (requiere login)
// ==========================================
export const getMyDiscoveries = async (req, res) => {
    try {
        const userId = req.userId;

        // Lugares creados por el usuario en historical_locations
        const placesResult = await db.raw(
            `SELECT id, name, description, image_url, category, latitude, longitude, created_at
             FROM historical_locations
             WHERE created_by_user_id = ?
             ORDER BY created_at DESC`,
            [userId]
        );

        // Aportes (fotos/info) subidos por el usuario a cualquier lugar
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
        console.error('Error en getMyDiscoveries:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ==========================================
// 🛡️ 5. ADMIN (mismo patron minimalista que los de historical_locations)
// ==========================================
export const getPendingContributions = async (req, res) => {
    try { const r = await db.raw('SELECT * FROM location_contributions WHERE is_approved = FALSE ORDER BY created_at DESC'); res.json(r.rows); }
    catch (e) { res.status(500).json({ error: e.message }); }
};
export const approveContribution = async (req, res) => {
    try { await db.raw('UPDATE location_contributions SET is_approved = TRUE, updated_at = now() WHERE id = ?', [req.params.id]); res.json({ msg: 'OK' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
};
export const rejectContribution = async (req, res) => {
    try { await db.raw('DELETE FROM location_contributions WHERE id = ?', [req.params.id]); res.json({ msg: 'Deleted' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
};
