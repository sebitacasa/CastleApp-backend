import jwt from 'jsonwebtoken';
import { SECRET_KEY } from '../config/jwtSecret.js';

// Hoy no existía NINGUNA verificación real de JWT en el backend -- endpoints
// como suggestLocation confiaban en un user_id mandado por el body, algo
// falsificable por cualquiera. Este middleware es el primero que realmente
// valida el token y expone req.userId, para que "usuario logeado" signifique
// algo de verdad en los endpoints nuevos que lo usen.
export const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'No autorizado: falta el token' });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        req.userId = decoded.id;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'No autorizado: token inválido o expirado' });
    }
};
