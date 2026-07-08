import { Request, Response } from 'express';
import db from '../config/db.js';
import { getRank } from './conquestController.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

// ─── Expo Push helper ─────────────────────────────────────────────────────────
async function sendPush(
    userId: number,
    title: string,
    body: string,
    data: Record<string, unknown> = {}
): Promise<void> {
    try {
        const r = await db.raw('SELECT push_token FROM users WHERE id = ?', [userId]);
        const token: string | undefined = r.rows[0]?.push_token;
        if (!token) return;
        await fetch('https://exp.host/--/expo-push/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ to: token, title, body, data, sound: 'default' }),
        });
    } catch (e) {
        const err = e as Error;
        console.error('[push]', err.message);
    }
}

async function displayName(userId: number): Promise<string> {
    const r = await db.raw('SELECT name, username FROM users WHERE id = ?', [userId]);
    const u = r.rows[0] as { name?: string; username?: string } | undefined;
    return u?.username ? `@${u.username}` : (u?.name || 'Someone');
}

// ─── Save / update push token for logged-in user ─────────────────────────────
export const updatePushToken = async (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (!token) return res.status(400).json({ error: 'Missing token' });
    try {
        await db.raw('UPDATE users SET push_token = ? WHERE id = ?', [token, req.userId]);
        res.json({ ok: true });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ─── Username helpers ─────────────────────────────────────────────────────────
export const getMyUsername = async (req: Request, res: Response) => {
    try {
        const r = await db.raw(`SELECT username FROM users WHERE id = ?`, [req.userId]);
        res.json({ username: r.rows[0]?.username || null });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const checkUsername = async (req: Request, res: Response) => {
    const { username } = req.query as { username?: string };
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
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const updateUsername = async (req: Request, res: Response) => {
    const { username } = req.body as { username?: string };
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
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ─── Search users by username or name ────────────────────────────────────────
export const searchUsers = async (req: Request, res: Response) => {
    const { q } = req.query as { q?: string };
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
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

// ─── Friend requests ──────────────────────────────────────────────────────────
export const sendFriendRequest = async (req: Request, res: Response) => {
    const { addresseeId } = req.body as { addresseeId?: number };
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

        // Notify addressee (fire-and-forget)
        displayName(requesterId!).then(name =>
            sendPush(addresseeId, '🤝 Friend Request', `${name} sent you a friend request`, { screen: 'Friends', tab: 'requests' })
        );
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const getMyFriends = async (req: Request, res: Response) => {
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
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const getPendingRequests = async (req: Request, res: Response) => {
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
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const respondToRequest = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { action } = req.body as { action?: string };
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

            // Notify the original requester (fire-and-forget)
            displayName(me!).then(name =>
                sendPush(existing.rows[0].requester_id, '🎉 Friend accepted!', `${name} accepted your friend request`, { screen: 'Friends', tab: 'friends' })
            );
        } else {
            await db.raw(`DELETE FROM friendships WHERE id = ?`, [id]);
            res.json({ status: 'rejected' });
        }
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const removeFriend = async (req: Request, res: Response) => {
    const { id } = req.params;
    const me = req.userId;
    try {
        await db.raw(
            `DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)`,
            [id, me, me]
        );
        res.json({ ok: true });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};

export const getFriendConquests = async (req: Request, res: Response) => {
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
        const total: number = conquests.rows.length;
        res.json({ conquests: conquests.rows, total, rank: getRank(total), user: userR.rows[0] });
    } catch (e) {
        const err = e as Error;
        res.status(500).json({ error: err.message });
    }
};
