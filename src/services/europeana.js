import axios from 'axios';

const EUROPEANA_API_KEY = 'ivediese';

export const searchHistoricalImages = async (query) => {
  try {
    const response = await axios.get('https://api.europeana.eu/record/v2/search.json', {
      params: {
        wskey: EUROPEANA_API_KEY,
        query: query,
        reusability: 'open',
        media: 'true',
        qf: 'TYPE:IMAGE'
      }
    });
    
    // --- AQUÍ EL LOG DE LA DATA CRUDA ---
    // JSON.stringify(dato, null, 2) hace que se vea bonito y ordenado
    // console.log("--- RESPUESTA API EUROPEANA ---");
    // console.log(JSON.stringify(response.data, null, 2)); 
    // // ------------------------------------

    const json = response.data;
    
    if (json.items) {
      const datosLimpios = json.items.map(item => ({
        id: item.id,
        title: item.title ? item.title[0] : 'Sin título',
        provider: item.dataProvider ? item.dataProvider[0] : 'Desconocido',
        image: item.edmIsShownBy ? item.edmIsShownBy[0] : null,
        description: item.dcDescription
      })).filter(item => item.image !== null);

       
      console.log("--- DATOS LIMPIOS QUE RECIBIRÁ LA APP ---");
       console.log(datosLimpios);
      // -------------------------------------------

      return datosLimpios;
    }
    
    return [];

  } catch (error) {
    // Es útil loguear el error completo para ver si es un 404, 500, etc.
    console.error("Error buscando en Europeana:", error.response ? error.response.data : error.message);
    return [];
  }
};