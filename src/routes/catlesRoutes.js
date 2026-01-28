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

router.get('/nuke-db', async (req, res) => {
    try {
        await db.raw('TRUNCATE TABLE historical_locations');
        res.send('✅ LISTO: Base de datos purgada.');
    } catch (e) {
        res.status(500).send('Error: ' + e.message);
    }
});
export default router;