// Fuente única del secreto de JWT. Antes vivía duplicado (una copia en
// authController.js), con riesgo de que un middleware nuevo recalculara el
// fallback por separado y los tokens dejaran de verificar entre sí.
export const SECRET_KEY = process.env.JWT_SECRET || 'mi_secreto_super_seguro';
