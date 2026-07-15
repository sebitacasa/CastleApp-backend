// Single source of truth for the JWT secret. Centralised here to prevent
// the risk of two copies computing different fallbacks and making tokens
// invalid across middleware and controllers.
const secret = process.env.JWT_SECRET;

if (!secret) {
    if (process.env.NODE_ENV === 'production') {
        // En producción NUNCA arrancamos con un secreto por defecto:
        // firmaría tokens con un valor público y cualquiera podría falsificarlos.
        throw new Error(
            'JWT_SECRET no está definido. Configúralo como variable de entorno antes de arrancar en producción.'
        );
    }
    console.warn(
        '⚠️  JWT_SECRET no está definido: usando un valor de desarrollo INSEGURO. No usar en producción.'
    );
}

export const SECRET_KEY: string = secret || 'dev_only_insecure_secret';
