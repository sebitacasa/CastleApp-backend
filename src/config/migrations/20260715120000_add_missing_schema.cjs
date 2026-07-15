/**
 * Migración ADITIVA e IDEMPOTENTE.
 *
 * El esquema real que consultan los controladores había divergido de la
 * migración original `20260117194446_db_final`:
 *   - Faltaban por completo las tablas `conquests`, `friendships` y
 *     `location_contributions`.
 *   - `historical_locations` se consulta con columnas que no existían en la
 *     migración original (latitude/longitude/is_approved/created_by_user_id/
 *     google_place_id/location_text).
 *   - `users` usa una columna `push_token` para notificaciones Expo.
 *
 * Producción ya tiene estas tablas/columnas (por eso funciona), así que todo
 * usa `IF NOT EXISTS`: en producción es un no-op y en un entorno local nuevo
 * deja el esquema alineado con el código.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // ── Columnas nuevas en tablas existentes ──────────────────────────────────
  await knex.raw(`
    ALTER TABLE historical_locations
      ADD COLUMN IF NOT EXISTS latitude           DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS longitude          DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS is_approved        BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS google_place_id    TEXT,
      ADD COLUMN IF NOT EXISTS location_text      TEXT
  `);

  await knex.raw(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS push_token TEXT
  `);

  // ── Tabla de conquistas ───────────────────────────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS conquests (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      google_place_id TEXT,
      location_id     INTEGER REFERENCES historical_locations(id) ON DELETE CASCADE,
      place_name      TEXT,
      place_lat       DOUBLE PRECISION,
      place_lon       DOUBLE PRECISION,
      user_lat        DOUBLE PRECISION,
      user_lon        DOUBLE PRECISION,
      image_url       TEXT,
      category        TEXT,
      conquered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS conquests_user_id_idx ON conquests (user_id)`);

  // ── Tabla de amistades ────────────────────────────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS friendships (
      id           SERIAL PRIMARY KEY,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (requester_id, addressee_id)
    )
  `);

  // ── Tabla de aportes de la comunidad ──────────────────────────────────────
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS location_contributions (
      id              SERIAL PRIMARY KEY,
      google_place_id TEXT,
      location_id     INTEGER REFERENCES historical_locations(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      photo_url       TEXT,
      info_text       TEXT,
      is_approved     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(`DROP TABLE IF EXISTS location_contributions`);
  await knex.raw(`DROP TABLE IF EXISTS friendships`);
  await knex.raw(`DROP TABLE IF EXISTS conquests`);

  await knex.raw(`ALTER TABLE users DROP COLUMN IF EXISTS push_token`);
  await knex.raw(`
    ALTER TABLE historical_locations
      DROP COLUMN IF EXISTS latitude,
      DROP COLUMN IF EXISTS longitude,
      DROP COLUMN IF EXISTS is_approved,
      DROP COLUMN IF EXISTS created_by_user_id,
      DROP COLUMN IF EXISTS google_place_id,
      DROP COLUMN IF EXISTS location_text
  `);
};
