import knex from 'knex';
import { development } from './knexfile.js';

// Esto inicializa la conexión real a PostgreSQL usando tu configuración
const db = knex(development);

export default db;