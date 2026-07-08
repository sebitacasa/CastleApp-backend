import { Request, Response } from 'express';
import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { SECRET_KEY } from '../config/jwtSecret.js';

dotenv.config();

const GOOGLE_CLIENT_ID: string =
    process.env.GOOGLE_CLIENT_ID ||
    '51752012600-igpkoafe26206ti3ie5bmnlln5gn1psc.apps.googleusercontent.com';

interface DbUser {
    id: number;
    username: string;
    email: string;
    password: string;
    avatar_url?: string | null;
}

// ==========================================
// 1. LOGIN CON GOOGLE
// ==========================================
export const googleLogin = async (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };

    console.log('🔵 [Backend] Iniciando Google Login...');

    if (!token) {
        return res.status(400).json({ message: 'No se proporcionó token de Google' });
    }

    try {
        const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);

        if (!googleResponse.ok) {
            const errorData = await googleResponse.json();
            console.error('❌ [Backend] Google rechazó el token:', errorData);
            return res.status(400).json({ message: 'Token de Google inválido o expirado' });
        }

        const googleUser = await googleResponse.json() as {
            aud: string;
            email: string;
            picture: string;
            name?: string;
            given_name?: string;
            email_verified?: boolean | string;
        };

        if (googleUser.aud !== GOOGLE_CLIENT_ID) {
            console.error('❌ [Backend] Token con audience desconocida:', googleUser.aud);
            return res.status(401).json({ message: 'Token de Google no emitido para esta app' });
        }

        const { email, picture } = googleUser;
        const name = googleUser.name || googleUser.given_name;

        const isVerified = googleUser.email_verified === true || googleUser.email_verified === 'true';
        if (!isVerified) {
            return res.status(403).json({ message: 'El correo de Google no está verificado.' });
        }

        console.log(`✅ [Backend] Token válido para: ${email}`);

        let user: DbUser | undefined = await db('users').where({ email }).first();

        if (!user) {
            console.log('🆕 [Backend] Usuario nuevo. Creando...');
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(randomPassword, salt);

            const [newUser] = await db('users').insert({
                username: name,
                email,
                avatar_url: picture,
                password: passwordHash,
            }).returning(['id', 'username', 'email', 'avatar_url']);

            user = newUser as DbUser;
        } else {
            console.log(`👋 [Backend] Usuario existente (ID: ${user.id}). Actualizando foto...`);
            await db('users').where({ id: user.id }).update({ avatar_url: picture });
            user.avatar_url = picture;
        }

        const appToken = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '7d' });

        res.json({
            message: 'Login con Google exitoso',
            user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url },
            token: appToken
        });

    } catch (error) {
        const e = error as Error;
        console.error('🔥 [Backend] Error CRÍTICO en Google Login:', e);
        res.status(500).json({ message: 'Error interno: ' + e.message });
    }
};

// ==========================================
// 2. REGISTRO NORMAL
// ==========================================
export const register = async (req: Request, res: Response) => {
    const { username, email, password } = req.body as { username: string; email: string; password: string };
    try {
        const userCheck = await db('users').where({ email }).orWhere({ username }).first();
        if (userCheck) return res.status(400).json({ message: 'El usuario o correo ya existe.' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const [newUser] = await db('users').insert({
            username,
            email,
            password: passwordHash
        }).returning(['id', 'username', 'email']);

        const token = jwt.sign({ id: newUser.id }, SECRET_KEY, { expiresIn: '7d' });

        res.status(201).json({ message: 'Usuario registrado', user: newUser, token });
    } catch (error) {
        const e = error as Error;
        console.error(e);
        res.status(500).json({ message: 'Error en el servidor: ' + e.message });
    }
};

// ==========================================
// 3. LOGIN NORMAL
// ==========================================
export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    try {
        const user: DbUser | undefined = await db('users').where({ email }).first();
        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Credenciales inválidas' });

        const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: '7d' });

        res.json({
            message: 'Login exitoso',
            user: { id: user.id, username: user.username, email: user.email },
            token
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

// ==========================================
// 4. ELIMINAR USUARIO
// ==========================================
export const deleteUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const deletedCount = await db('users').where({ id }).del();
        if (deletedCount === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        res.json({ message: 'Cuenta eliminada con éxito' });
    } catch (error) {
        console.error('Error borrando usuario:', error);
        res.status(500).json({ error: 'Error al eliminar la cuenta' });
    }
};

// ==========================================
// 5. TEST USER (Helper / Debug)
// ==========================================
export const createTestUser = async (req: Request, res: Response) => {
    try {
        const tableInfo = await db.raw("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
        res.json({
            message: 'Columnas encontradas en la tabla users:',
            columns: tableInfo.rows.map((row: { column_name: string }) => row.column_name)
        });
    } catch (error) {
        const e = error as Error;
        res.status(500).json({ error: e.message });
    }
};
