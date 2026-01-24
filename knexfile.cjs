require('dotenv').config();

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  // 💻 Configuración para tu PC (Local)
  development: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5433,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'test_password_123',
      database: process.env.DB_DATABASE || 'map_tracker_db2',
    },
    migrations: {
      directory: './migrations',
    },
    useNullAsDefault: true
  },

  // 🚀 Configuración para Railway (Producción)
  production: {
    client: 'pg',
    connection: {
      // Railway guarda la dirección completa en esta variable automáticamente:
      connectionString: process.env.DATABASE_URL, 
      ssl: { rejectUnauthorized: false } // ⚠️ ESTO ES VITAL: Permite conectar con seguridad
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: '../src/config/migrations'
    }
  }
};