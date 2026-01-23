/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function(knex) {
  // 1. 🧹 LIMPIEZA TOTAL (Borrar en orden para evitar errores de llaves foráneas)
  await knex('visited_places').del();
  await knex('follows').del();
  await knex('historical_locations').del(); // <--- ¡Importante borrar esto también!
  await knex('users').del();

  // 2. 👤 CREAR USUARIOS
  await knex('users').insert([
    { 
      id: 1, 
      username: 'SebasDev', 
      email: 'sebas@test.com', 
      password: '123', 
      avatar_url: 'https://i.pravatar.cc/150?img=11' 
    },
    { 
      id: 2, 
      username: 'AnaExplorer', 
      email: 'ana@test.com', 
      password: '123', 
      avatar_url: 'https://i.pravatar.cc/150?img=5' 
    },
    { 
      id: 3, 
      username: 'MarcosViajero', 
      email: 'marcos@test.com', 
      password: '123', 
      avatar_url: 'https://i.pravatar.cc/150?img=3' 
    }
  ]);

  // 3. 🏰 CREAR LUGARES HISTÓRICOS (¡Esto es lo que faltaba!)
  // Usamos knex.raw para la geometría porque PostGIS lo requiere así.
  await knex('historical_locations').insert([
    {
      id: 1,
      name: 'Obelisco de Buenos Aires',
      category: 'Monumento',
      description: 'Icono histórico de la ciudad.',
      country: 'Argentina',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Obelisco_BA_2014.jpg/800px-Obelisco_BA_2014.jpg',
      images: ['https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Obelisco_BA_2014.jpg/800px-Obelisco_BA_2014.jpg'], // Array de texto
      geom: knex.raw('ST_SetSRID(ST_MakePoint(-58.3816, -34.6037), 4326)') // Buenos Aires
    },
    {
      id: 2,
      name: 'Castillo de San Telmo',
      category: 'Fortaleza',
      description: 'Un lugar lleno de historia y misterio.',
      country: 'Argentina',
      image_url: 'https://turismo.buenosaires.gob.ar/sites/turismo/files/san_telmo_1200.jpg',
      images: ['https://turismo.buenosaires.gob.ar/sites/turismo/files/san_telmo_1200.jpg'],
      geom: knex.raw('ST_SetSRID(ST_MakePoint(-58.3731, -34.6212), 4326)') // San Telmo
    },
    {
      id: 3,
      name: 'Coliseo Romano',
      category: 'Ruins',
      description: 'El anfiteatro más grande construido durante el Imperio Romano.',
      country: 'Italia',
      image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/800px-Colosseo_2020.jpg',
      images: ['https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/800px-Colosseo_2020.jpg'],
      geom: knex.raw('ST_SetSRID(ST_MakePoint(12.4922, 41.8902), 4326)') // Roma
    }
  ]);

  // 4. ✅ CREAR VISITAS (El vínculo mágico)
  await knex('visited_places').insert([
    // Tú (ID 1) visitaste el Obelisco (ID 1)
    { user_id: 1, location_id: 1, visited_at: new Date() },
    
    // Ana (ID 2) visitó el Obelisco (ID 1) y el Coliseo (ID 3)
    { user_id: 2, location_id: 1, visited_at: new Date() },
    { user_id: 2, location_id: 3, visited_at: new Date() },

    // Marcos (ID 3) visitó San Telmo (ID 2)
    { user_id: 3, location_id: 2, visited_at: new Date() }
  ]);
  
  // 5. 🤝 CREAR SEGUIMIENTOS (Amigos)
  await knex('follows').insert([
    { follower_id: 1, following_id: 2 }, // Tú sigues a Ana
    { follower_id: 1, following_id: 3 }  // Tú sigues a Marcos
  ]);
};