import { Router } from 'express';
import { register, login, googleLogin } from '../controller/authController.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLogin); // <--- Nueva ruta

export default router;