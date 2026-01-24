import knex from 'knex';
// Importamos la configuración. Al ser CommonJS, a veces se importa como 'default'.
import knexFile from '../../knexfile.js'; 

const environment = process.env.NODE_ENV || 'development';

// Seleccionamos la configuración (development o production)
const config = knexFile[environment];

const db = knex(config);

export default db;