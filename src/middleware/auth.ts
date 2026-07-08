import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { SECRET_KEY } from '../config/jwtSecret.js';

export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        res.status(401).json({ error: 'No autorizado: falta el token' });
        return;
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY) as { id: number; [key: string]: unknown };
        req.userId = decoded.id;
        next();
    } catch {
        res.status(401).json({ error: 'No autorizado: token inválido o expirado' });
    }
};
