exports.up = function(knex) {
  return knex.schema.table('historical_locations', (table) => {
    // Definimos la columna como string y permitimos explícitamente que sea nula
    table.string('wiki_title').nullable(); 
  });
};

exports.down = function(knex) {
  return knex.schema.table('historical_locations', (table) => {
    // En el rollback, eliminamos la columna para volver al estado anterior
    table.dropColumn('wiki_title');
  });
};