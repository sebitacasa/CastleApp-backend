import 'dotenv/config'

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
export const development = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT,
  },
  migrations: {
    directory: './migrations' // Importante especificar dónde se guardan
  }
};

export const staging = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  },
  pool: {
    min: 2,
    max: 10
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations'
  }
};

// 🚀 ESTA ES LA PARTE IMPORTANTE PARA RAILWAY
export const production = {
  client: 'pg',
  connection: {
    // Railway inyecta la URL completa aquí automáticamente:
    connectionString: process.env.DATABASE_URL,
    // El SSL es obligatorio en la nube:
    ssl: { rejectUnauthorized: false }
  },
  pool: {
    min: 2,
    max: 10
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations '
  }
};