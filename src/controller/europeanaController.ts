import { Request, Response } from 'express';
import axios from 'axios';

export const getProxyImage = async (req: Request, res: Response): Promise<void> => {
    try {
        const { url } = req.query;
        if (!url || typeof url !== 'string') {
            res.status(400).send('Missing url parameter');
            return;
        }
        const response = await axios({
            url: decodeURIComponent(url),
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000,
        }) as any;
        res.set('Content-Type', response.headers['content-type']);
        res.set('Cache-Control', 'public, max-age=86400');
        response.data.pipe(res);
    } catch {
        if (!res.headersSent) res.status(404).end();
    }
};
