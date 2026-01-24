import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import axios from 'axios';
import castleRoutes from "./src/routes/catlesRoutes.js"
import authRoutes from './src/routes/auth.routes.js';
import socialRoutes from './src/routes/socialRoutes.js'


const app = express();
const port = 8080;

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'map_tracker_db',    
  password: 'test_password_123',
  port: 5433,                    
});
app.use(cors());
app.use(express.json());


app.get('/', (req, res) => {
  res.send('✅ Castle Server (English Version) is running!');
});

// 1. MAIN ENDPOINT: SEARCH + FILTER + SAVE
app.use('/api', castleRoutes);
app.use('/social', socialRoutes);

app.use('/auth', authRoutes);

// app.listen(port, () => {
//     console.log(`🏰 Server running in ENGLISH at http://localhost:${port}`);
// });
// 2. ENDPOINT: BÚSQUEDA GEOESPACIAL (Cercanía)

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
});

