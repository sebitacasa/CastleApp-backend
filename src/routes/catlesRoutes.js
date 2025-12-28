import { Router } from 'express';
import { getLocalizaciones, getProxyImage, getLocationDescription } from '../controller/europeanaController.js'; // Importamos el controlador

const router = Router();

// Vinculamos la URL con la función del controlador
router.get('/localizaciones', getLocalizaciones);

router.get('/image-proxy', getProxyImage);
// Si tenés la de "cercanas", podés hacer otro controlador para esa:
// router.get('/localizaciones/cercanas', getCercanas);

// Agrega esto donde defines tus rutas
router.get('/localizaciones/:id/description', getLocationDescription);
export default router;