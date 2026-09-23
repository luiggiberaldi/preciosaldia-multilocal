export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const targetUrl = req.query.url;
        if (!targetUrl) {
            return res.status(400).json({ error: 'Falta el parámetro url.' });
        }

        const response = await fetch(targetUrl);
        if (!response.ok) {
            return res.status(response.status).json({ error: `Error fetching target image: ${response.statusText}` });
        }

        const contentType = response.headers.get('Content-Type') || 'image/png';
        const buffer = await response.arrayBuffer();

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(Buffer.from(buffer));
    } catch (err) {
        console.error('[ImageProxy] Error:', err);
        return res.status(500).json({ error: err.message });
    }
}
