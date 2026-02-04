import db from '../config/db.js'; // Asegúrate de que esta ruta sea correcta
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from 'crypto'; // Importante para generar contraseñas random en Google Login

dotenv.config();

const SECRET_KEY = process.env.JWT_SECRET || 'mi_secreto_super_seguro';

// ==========================================
// 🔥 1. LOGIN CON GOOGLE (CORREGIDO)
// ==========================================
export const googleLogin = async (req, res) => {
    const { token } = req.body; 

    console.log("🔵 [Backend] Iniciando Google Login...");

    if (!token) {
        return res.status(400).json({ message: 'No se proporcionó token de Google' });
    }

    try {
        // 1. Validar el token con Google usando el endpoint correcto (tokeninfo)
        const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);

        if (!googleResponse.ok) {
            const errorData = await googleResponse.json();
            console.error("❌ [Backend] Google rechazó el token:", errorData);
            return res.status(400).json({ message: 'Token de Google inválido o expirado' });
        }

        const googleUser = await googleResponse.json();
        const { email, picture } = googleUser;
        // A veces el nombre viene en 'name' o 'given_name'
        const name = googleUser.name || googleUser.given_name; 
        
        // Verificación de email (Google a veces manda bool o string)
        const isVerified = googleUser.email_verified === true || googleUser.email_verified === "true";
        if (!isVerified) {
            return res.status(403).json({ message: 'El correo de Google no está verificado.' });
        }

        console.log(`✅ [Backend] Token válido para: ${email}`);

        // 2. Buscar si el usuario ya existe en DB
        let user = await db('users').where({ email }).first();

        if (!user) {
            console.log("🆕 [Backend] Usuario nuevo. Creando...");
            
            // Generar contraseña aleatoria segura (porque la columna password es obligatoria)
            const randomPassword = crypto.randomBytes(16).toString('hex');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(randomPassword, salt);

            // Insertar usuario nuevo
            // ⚠️ NOTA: Cambié 'password_hash' por 'password' para arreglar tu error de DB
            const [newUser] = await db('users').insert({
                username: name, 
                email: email,
                avatar_url: picture, 
                password: passwordHash, // <--- CAMBIO AQUÍ (antes era password_hash)
            }).returning(['id', 'username', 'email', 'avatar_url']);
            
            user = newUser;
        } else {
            console.log("👋 [Backend] Usuario existente (ID: " + user.id + "). Actualizando foto...");
            // Actualizar foto
            await db('users')
                .where({ id: user.id })
                .update({ avatar_url: picture });
            
            user.avatar_url = picture;
        }

        // 3. Generar JWT para la App
        const appToken = jwt.sign(
            { id: user.id, email: user.email }, 
            SECRET_KEY, 
            { expiresIn: '7d' }
        );

        // 4. Responder
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
        console.error('🔥 [Backend] Error CRÍTICO en Google Login:', error);
        // Enviamos el mensaje de error exacto para depurar mejor
        res.status(500).json({ message: 'Error interno: ' + error.message });
    }
};

// ==========================================
// 2. REGISTRO NORMAL (ACTUALIZADO)
// ==========================================
export const register = async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const userCheck = await db('users').where({ email }).orWhere({ username }).first();
        if (userCheck) return res.status(400).json({ message: 'El usuario o correo ya existe.' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // ⚠️ Usamos 'password' en vez de 'password_hash' para consistencia
        const [newUser] = await db('users').insert({
            username, 
            email, 
            password: passwordHash 
        }).returning(['id', 'username', 'email']);

        const token = jwt.sign({ id: newUser.id }, SECRET_KEY, { expiresIn: '7d' });

        res.status(201).json({ message: 'Usuario registrado', user: newUser, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor: ' + error.message });
    }
};

// ==========================================
// 3. LOGIN NORMAL (ACTUALIZADO)
// ==========================================
export const login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await db('users').where({ email }).first();
        if (!user) return res.status(400).json({ message: 'Credenciales inválidas' });

        // ⚠️ Comparamos contra user.password
        const isMatch = await bcrypt.compare(password, user.password); // <--- CAMBIO AQUÍ
        if (!isMatch) return res.status(400).json({ message: 'Credenciales inválidas' });

        const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: '7d' });

        res.json({ message: 'Login exitoso', user: { id: user.id, username: user.username, email: user.email }, token });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

// ==========================================
// 4. ELIMINAR USUARIO (HELPER)
// ==========================================
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    // Intenta borrar. Si falla por Foreign Key, descomenta las líneas de abajo
    // await db('favorites').where({ user_id: id }).del();
    // await db('locations').where({ user_id: id }).del();
    
    const deletedCount = await db('users').where({ id }).del();

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json({ message: 'Cuenta eliminada con éxito' });
  } catch (error) {
    console.error("Error borrando usuario:", error);
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
};

// ==========================================
// 5. TEST USER (HELPER)
// ==========================================
export const createTestUser = async (req, res) => {
    try {
        // Devuelve información de las columnas de la tabla users para depurar
        const tableInfo = await db.raw("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
        res.json({
            message: "Columnas encontradas en la tabla users:",
            columns: tableInfo.rows.map(row => row.column_name)
        }); 
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};