// Single source of truth for the JWT secret. Centralised here to prevent
// the risk of two copies computing different fallbacks and making tokens
// invalid across middleware and controllers.
export const SECRET_KEY: string = process.env.JWT_SECRET || 'mi_secreto_super_seguro';
