require('dotenv').config();

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
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
  }
};