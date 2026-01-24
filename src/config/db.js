import knex from 'knex';
// 1. Importamos TODAS las configuraciones (development, production, etc.)
import * as knexConfig from './knexfile.js'; 

// 2. Preguntamos: "¿En qué entorno estamos?"
// Si Railway nos dice "production", usamos eso. Si no dice nada, asumimos "development".
const environment = process.env.NODE_ENV || 'development';

// 3. Seleccionamos la configuración correcta del objeto que importamos
const connectionConfig = knexConfig[environment];

// 4. Inicializamos la conexión
const db = knex(connectionConfig);

export default db;