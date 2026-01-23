/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Activar PostGIS
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');

  // 2. Tabla de USUARIOS
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username').notNullable().unique();
    table.string('email').notNullable().unique();
    table.string('password').notNullable();
    table.string('avatar_url');
    table.timestamps(true, true);
  });

  // 3. Tabla de LUGARES (Con fotos y mapas)
  await knex.schema.createTable('historical_locations', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.string('category').defaultTo('Others');
    table.text('description');
    table.string('country');
    table.text('image_url');
    table.specificType('images', 'text[]');
    table.specificType('geom', 'geometry(Point, 4326)'); 
    table.string('author');   // Para el nombre del artista
    table.string('license');  // Para el tipo de licencia (ej: CC BY-SA 4.0)
    table.timestamps(true, true);
  });
  await knex.raw('CREATE INDEX historical_locations_geom_idx ON historical_locations USING GIST (geom)');

  // 4. Tabla de SEGUIDORES
  await knex.schema.createTable('follows', (table) => {
    table.increments('id').primary();
    table.integer('follower_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('following_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.unique(['follower_id', 'following_id']);
  });

  // 5. Tabla de VISITAS
  await knex.schema.createTable('visited_places', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE');
    table.integer('location_id').unsigned().references('id').inTable('historical_locations').onDelete('CASCADE');
    table.timestamp('visited_at').defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('visited_places');
  await knex.schema.dropTableIfExists('follows');
  await knex.schema.dropTableIfExists('historical_locations');
  await knex.schema.dropTableIfExists('users');
};