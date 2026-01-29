import { Router } from 'express';
import { getLocalizaciones, getProxyImage, getLocationDescription } from '../controller/europeanaController.js'; // Importamos el controlador
import db from '../config/db.js';
import { getGoogleLocations, getWikiFullDetails } from '../controller/googleLocationController.js';
const router = Router();

// Vinculamos la URL con la función del controlador
//router.get('/localizaciones', getLocalizaciones);

router.get('/image-proxy', getProxyImage);
// Si tenés la de "cercanas", podés hacer otro controlador para esa:
// router.get('/localizaciones/cercanas', getCercanas);

// Agrega esto donde defines tus rutas
router.get('/localizaciones/:id/description', getLocationDescription);

router.get('/wiki-details', getWikiFullDetails);

router.get('/nuke-db', async (req, res) => {
    try {
        // 🔥 AGREGAMOS "CASCADE" PARA BORRAR TAMBIÉN FAVORITOS VINCULADOS
        await db.raw('TRUNCATE TABLE historical_locations CASCADE');
        res.send('✅ LISTO: Base de datos purgada (y referencias limpiadas). Reinicia la app.');
    } catch (e) {
        res.status(500).send('Error: ' + e.message);
    }
});



// router.get('/locations', getLocalizaciones); // <-- El viejo (OpenStreetMap)
router.get('/localizaciones', getGoogleLocations); // <-- El nuevo (Google)
export default router;