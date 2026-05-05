import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createServer as createSignalingServer } from '../signaling/server.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FRONTEND_DIR = join(__dirname, '..', 'frontend');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const httpServer = createServer(async (req, res) => {
    let filePath = resolve(FRONTEND_DIR, req.url === '/' ? 'index.html' : '.' + req.url);
    if (!filePath.startsWith(FRONTEND_DIR)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    const ext = extname(filePath);
    try {
        const content = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(content);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
});

createSignalingServer({ server: httpServer });

const PORT = process.env.PORT || 3333;
httpServer.listen(PORT, () => {
    console.log(`Test server listening on http://localhost:${PORT}`);
});

export { httpServer };
