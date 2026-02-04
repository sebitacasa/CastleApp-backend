import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto'; // 1. Importamos esto para generar contraseñas random

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || 'mi_secreto_super_seguro';

// --- LOGIN CON GOOGLE (Backend) ---
export const googleLogin = async (req, res) => {
    const { token } = req.body; 

    if (!token) {
        return res.status(400).json({ message: 'No se proporcionó token de Google' });
    }

    try {
        // 👇 CAMBIO CLAVE AQUÍ 👇
        // En lugar de llamar a userinfo con Bearer, llamamos al endpoint de validación de ID Token
        const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);

        if (!googleResponse.ok) {
            // Si el token es viejo o falso, Google devuelve error aquí
            const errorData = await googleResponse.json();
            console.error("Error validando token Google:", errorData);
            return res.status(400).json({ message: 'Token de Google inválido o expirado' });
        }

        const googleUser = await googleResponse.json();
        
        // 🔍 DEBUG: Ver qué devuelve Google (opcional)
        // console.log("Google User Data:", googleUser);

        // Extraemos los datos. 
        // NOTA: A veces 'name' no viene en tokeninfo, usamos 'given_name' si no hay 'name'.
        const { email, sub, picture } = googleUser;
        const name = googleUser.name || googleUser.given_name; 
        
        // Corrección de seguridad: email_verified a veces viene como string "true"
        const isVerified = googleUser.email_verified === true || googleUser.email_verified === "true";

        if (!isVerified) {
            return res.status(403).json({ message: 'El correo de Google no está verificado.' });
        }

        // 3. Buscar si el usuario ya existe en nuestra DB
        let user = await db('users').where({ email }).first();

        if (!user) {
            // A) CREAR USUARIO
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(randomPassword, salt);

            const [newUser] = await db('users').insert({
                username: name, 
                email: email,
                avatar_url: picture,
                password_hash: passwordHash, 
                // google_id: sub // Recomendado guardar el ID único de Google (sub)
            }).returning(['id', 'username', 'email', 'avatar_url']);
            
            user = newUser;
        } else {
            // B) ACTUALIZAR FOTO
            await db('users')
                .where({ id: user.id })
                .update({ avatar_url: picture });
            
            user.avatar_url = picture;
        }

        // 4. Generar NUESTRO token (JWT)
        const appToken = jwt.sign(
            { id: user.id, email: user.email }, 
            SECRET_KEY, 
            { expiresIn: '7d' }
        );

        // 5. Responder
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
        // 👇 ESTA CONSULTA NOS DIRÁ LA VERDAD SOBRE TU TABLA DE LUGARES
        const tableInfo = await db.raw("SELECT column_name FROM information_schema.columns WHERE table_name = 'historical_locations'");
        
        res.json({
            message: "Columnas encontradas en la tabla historical_locations:",
            columns: tableInfo.rows.map(row => row.column_name)
        }); 
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


// export const createTestUser = async (req, res) => {
//     const { email, name, photo } = req.body;

//     try {
//         // 1. Revisar si ya existe
//         const check = await db.raw('SELECT * FROM users WHERE email = ?', [email]);
//         if (check.rows.length > 0) {
//             return res.status(200).json({ 
//                 message: "El usuario ya existe, aquí tienes su ID:", 
//                 user: check.rows[0] 
//             });
//         }

//         // 2. Crear usuario nuevo usando los nombres REALES de tus columnas
//         // Usamos: username, avatar_url y una contraseña dummy
//         const newUser = await db.raw(
//             `INSERT INTO users (email, username, avatar_url, password) 
//              VALUES (?, ?, ?, 'password_prueba_123') 
//              RETURNING *`,
//             [email, name, photo || 'https://via.placeholder.com/150']
//         );

//         res.status(201).json({ 
//             message: "Usuario de prueba creado con éxito", 
//             user: newUser.rows[0] 
//         });

//     } catch (error) {
//         console.error("Error al crear usuario:", error);
//         res.status(500).json({ error: error.message });
//     }
// };