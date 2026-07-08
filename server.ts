import express from 'express';
import cors from 'cors';
import castleRoutes from './src/routes/catlesRoutes.js';
import authRoutes from './src/routes/auth.routes.js';
import socialRoutes from './src/routes/socialRoutes.js';

const app: express.Application = express();
const port = 8080;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('✅ Castle Server (English Version) is running!');
});

app.use('/api', castleRoutes);
app.use('/social', socialRoutes);
app.use('/auth', authRoutes);

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
});
