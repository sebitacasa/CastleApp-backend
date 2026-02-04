import { Router } from 'express';
import { register, login, googleLogin, deleteUser, createTestUser} from '../controller/authController.js';

const router = Router();

router.post('/register', register);
router.post('/create-test', createTestUser);
router.delete('/:id', deleteUser);
router.post('/login', login);
router.post('/google', googleLogin); // <--- Nueva ruta
// DELETE /api/users/:id
// Asegúrate de proteger esta ruta si tienes middleware de autenticación
router.delete('/users/:id', deleteUser);
export default router;