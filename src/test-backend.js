// test-backend.js
import { searchHistoricalImages } from './services/europeana.js'; 
// OJO: En Node es obligatorio poner la extensión '.js' al final del import

async function ejecutarPrueba() {
  console.log("🚀 Iniciando script de backend...");
  
  try {
    const resultados = await searchHistoricalImages("Neuschwanstein-Castle");
    
    console.log("✅ Datos recibidos:");
    console.log(JSON.stringify(resultados, null, 2));
    
    // Aquí es donde, en el futuro, pondrías el código para guardar en tu DB
    // await guardarEnBaseDeDatos(resultados);

  } catch (error) {
    console.error("❌ Algo falló:", error);
  }
}

ejecutarPrueba();