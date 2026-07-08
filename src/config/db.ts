import knex from 'knex';
import type { Knex } from 'knex';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const knexFile = require('../../knexfile.cjs') as Record<string, Knex.Config>;

const environment: string = process.env.NODE_ENV || 'development';
const config: Knex.Config = knexFile[environment];

const db = knex(config);

export default db;
