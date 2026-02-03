import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto'; // 1. Importamos esto para generar contraseñas random

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || 'mi_secreto_super_seguro';

// --- LOGIN CON GOOGLE (Backend) ---
export const googleLogin = async (req, res) => {
    const { token } = req.body; // El token que recibimos del frontend

    if (!token) {
        return res.status(400).json({ message: 'No se proporcionó token de Google' });
    }

    try {
        // 1. Validar el token con los servidores de Google
        const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!googleResponse.ok) {
            return res.status(400).json({ message: 'Token de Google inválido o expirado' });
        }

        const googleUser = await googleResponse.json();
        
        // Google devuelve: sub, name, given_name, family_name, picture, email, email_verified
        const { email, name, picture, email_verified } = googleUser;

        // 2. Seguridad: Verificar que el email sea legítimo
        if (!email_verified) {
            return res.status(403).json({ message: 'El correo de Google no está verificado.' });
        }

        // 3. Buscar si el usuario ya existe en nuestra DB
        let user = await db('users').where({ email }).first();

        if (!user) {
            // A) NO EXISTE: Lo creamos (Registro Automático)
            
            // Generamos una contraseña basura segura para cumplir con la DB (NOT NULL)
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(randomPassword, salt);

            const [newUser] = await db('users').insert({
                username: name, // Ojo: Si 'username' es UNIQUE en tu DB, esto podría fallar si hay dos "Sebastian". 
                email: email,
                avatar_url: picture,
                password_hash: passwordHash, // Guardamos la contraseña generada
                // google_id: googleUser.sub // (Opcional) Si tienes esta columna, es bueno guardarla
            }).returning(['id', 'username', 'email', 'avatar_url']);
            
            user = newUser;
        } else {
            // B) SI EXISTE: Actualizamos la foto por si la cambió
            await db('users')
                .where({ id: user.id })
                .update({ avatar_url: picture });
            
            // Actualizamos el objeto user local para devolver la foto nueva
            user.avatar_url = picture;
        }

        // 4. Generar NUESTRO token (JWT) para que la app lo use
        const appToken = jwt.sign(
            { id: user.id, email: user.email }, 
            SECRET_KEY, // Usamos la constante unificada
            { expiresIn: '7d' }
        );

        // 5. Responder al Frontend
        res.json({
            message: 'Login con Google exitoso',
            user: { 
                id: user.id, 
                username: user.username, 
                email: user.email, 
                avatar_url: user.avatar_url 
            },
            token: appToken
        });

    } catch (error) {
        console.error('Error crítico en Google Login:', error);
        res.status(500).json({ message: 'Error interno al procesar Google Login' });
    }
};

// --- (El resto de tus funciones register y login las dejé igual, solo asegurando SECRET_KEY) ---

export const register = async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const userCheck = await db('users').where({ email }).orWhere({ username }).first();
        if (userCheck) return res.status(400).json({ message: 'El usuario o correo ya existe.' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const [newUser] = await db('users').insert({
            username, email, password_hash: passwordHash
        }).returning(['id', 'username', 'email']);

        const token = jwt.sign({ id: newUser.id }, SECRET_KEY, { expiresIn: '7d' });

        res.status(201).json({ message: 'Usuario registrado', user: newUser, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

export const login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await db('users').where({ email }).first();
        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ message: 'Credenciales inválidas' });

        const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: '7d' });

        res.json({ message: 'Login exitoso', user: { id: user.id, username: user.username, email: user.email }, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

// EN: controller/authController.js

// Asegúrate de tener esto arriba (o como se llame tu archivo de conexión)
// import { pool } from '../db.js'; 

export const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. IMPORTANTE: Borrar datos relacionados (Foreign Keys)
    // Si no tienes configurado "ON DELETE CASCADE" en tu base de datos,
    // esto fallará si no borras primero los favoritos o lugares del usuario.
    // Descomenta esto si te da error de "violación de llave foránea":
    
    // await pool.query('DELETE FROM favorites WHERE user_id = $1', [id]);
    // await pool.query('DELETE FROM locations WHERE user_id = $1', [id]);
    
    // 2. Borrar al usuario
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ message: 'Cuenta eliminada con éxito', deletedUser: result.rows[0] });

  } catch (error) {
    console.error("Error borrando usuario:", error);
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
};

export const createTestUser = async (req, res) => {
    try {
        // 👇 Esto nos dirá EXACTAMENTE qué columnas tiene la tabla 'users'
        const tableInfo = await db.raw("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
        res.json(tableInfo.rows); 
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};