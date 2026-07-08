import db from '../config/db.js';
import { getRank } from './conquestController.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

// ─── Setup: friendships table + username column on users ──────────────────────
export const setupFriendshipsTables = async (req, res) => {
    try {
        await db.raw(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));
            CREATE TABLE IF NOT EXISTS friendships (
                id           serial PRIMARY KEY,
                requester_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                addressee_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status       text NOT NULL DEFAULT 'pending',
                created_at   timestamptz NOT NULL DEFAULT now(),
                UNIQUE (requester_id, addressee_id),
                CHECK (requester_id != addressee_id)
            );
            CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
            CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);
        `);
        res.send('✅ friendships table + username column created (or already existed).');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error: ' + e.message);
    }
};

// ─── Username helpers ─────────────────────────────────────────────────────────

export const getMyUsername = async (req, res) => {
    try {
        const r = await db.raw(`SELECT username FROM users WHERE id = ?`, [req.userId]);
        res.json({ username: r.rows[0]?.username || null });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const checkUsername = async (req, res) => {
    const { username } = req.query;
    if (!username || !USERNAME_REGEX.test(username)) {
        return res.json({ available: false, reason: 'invalid' });
    }
    try {
        const r = await db.raw(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?`,
            [username, req.userId]
        );
        res.json({ available: r.rows.length === 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const updateUsername = async (req, res) => {
    const { username } = req.body;
    if (!username || !USERNAME_REGEX.test(username)) {
        return res.status(400).json({ error: 'invalid', message: '3–20 characters: letters, numbers, underscores only.' });
    }
    try {
        const taken = await db.raw(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?`,
            [username, req.userId]
        );
        if (taken.rows.length > 0) return res.status(409).json({ error: 'taken' });
        await db.raw(`UPDATE users SET username = ? WHERE id = ?`, [username, req.userId]);
        res.json({ username });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Search users by username or name ────────────────────────────────────────
export const searchUsers = async (req, res) => {
    const { q } = req.query;
    const me = req.userId;
    if (!q || q.trim().length < 2) return res.json({ users: [] });
    const like = `%${q.trim()}%`;
    try {
        const r = await db.raw(`
            SELECT
                u.id,
                u.username,
                u.name,
                u.picture AS avatar,
                COALESCE(f.status, 'none') AS friendship_status,
                f.id AS friendship_id,
                f.requester_id
            FROM users u
            LEFT JOIN friendships f ON (
                (f.requester_id = ? AND f.addressee_id = u.id) OR
                (f.addressee_id = ? AND f.requester_id = u.id)
            )
            WHERE u.id != ?
              AND (u.username ILIKE ? OR u.name ILIKE ?)
            ORDER BY
                CASE WHEN LOWER(u.username) = LOWER(?) THEN 0 ELSE 1 END,
                u.username NULLS LAST
            LIMIT 20
        `, [me, me, me, like, like, q.trim()]);
        res.json({ users: r.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ─── Friend requests ──────────────────────────────────────────────────────────

export const sendFriendRequest = async (req, res) => {
    const { addresseeId } = req.body;
    const requesterId = req.userId;
    if (!addresseeId || Number(addresseeId) === requesterId) {
        return res.status(400).json({ error: 'Invalid addressee' });
    }
    try {
        const existing = await db.raw(
            `SELECT id, status FROM friendships
             WHERE (requester_id = ? AND addressee_id = ?)
                OR (requester_id = ? AND addressee_id = ?)`,
            [requesterId, addresseeId, addresseeId, requesterId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'already_exists', status: existing.rows[0].status });
        }
        const r = await db.raw(
            `INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?) RETURNING *`,
            [requesterId, addresseeId]
        );
        res.json({ friendship: r.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const getMyFriends = async (req, res) => {
    const me = req.userId;
    try {
        const r = await db.raw(`
            SELECT
                u.id,
                u.username,
                u.name,
                u.picture AS avatar,
                f.id AS friendship_id,
                COUNT(c.id)::int AS conquest_count
            FROM friendships f
            JOIN users u ON u.id = CASE
                WHEN f.requester_id = ? THEN f.addressee_id
                ELSE f.requester_id
            END
            LEFT JOIN conquests c ON c.user_id = u.id
            WHERE (f.requester_id = ? OR f.addressee_id = ?)
              AND f.status = 'accepted'
            GROUP BY u.id, u.username, u.name, u.picture, f.id
            ORDER BY conquest_count DESC, u.name
        `, [me, me, me]);
        res.json({ friends: r.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const getPendingRequests = async (req, res) => {
    const me = req.userId;
    try {
        const r = await db.raw(`
            SELECT
                f.id, f.created_at,
                u.id AS sender_id, u.username, u.name, u.picture AS avatar
            FROM friendships f
            JOIN users u ON u.id = f.requester_id
            WHERE f.addressee_id = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC
        `, [me]);
        res.json({ requests: r.rows });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const respondToRequest = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    const me = req.userId;
    try {
        const existing = await db.raw(
            `SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = 'pending'`,
            [id, me]
        );
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
        if (action === 'accept') {
            await db.raw(`UPDATE friendships SET status = 'accepted' WHERE id = ?`, [id]);
            res.json({ status: 'accepted' });
        } else {
            await db.raw(`DELETE FROM friendships WHERE id = ?`, [id]);
            res.json({ status: 'rejected' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const removeFriend = async (req, res) => {
    const { id } = req.params;
    const me = req.userId;
    try {
        await db.raw(
            `DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)`,
            [id, me, me]
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const getFriendConquests = async (req, res) => {
    const { userId } = req.params;
    const me = req.userId;
    try {
        const friendship = await db.raw(
            `SELECT id FROM friendships
             WHERE status = 'accepted'
               AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
            [me, userId, userId, me]
        );
        if (friendship.rows.length === 0) return res.status(403).json({ error: 'not_friends' });
        const conquests = await db.raw(
            `SELECT * FROM conquests WHERE user_id = ? ORDER BY conquered_at DESC`, [userId]
        );
        const userR = await db.raw(
            `SELECT username, name, picture AS avatar FROM users WHERE id = ?`, [userId]
        );
        const total = conquests.rows.length;
        res.json({ conquests: conquests.rows, total, rank: getRank(total), user: userR.rows[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
