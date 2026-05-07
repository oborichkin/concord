import { test as base, expect } from '@playwright/test';
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

async function startServer() {
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

    return new Promise((resolve) => {
        httpServer.listen(0, () => {
            const port = httpServer.address().port;
            resolve({ server: httpServer, url: `http://localhost:${port}` });
        });
    });
}

async function waitForConnect(page) {
    await page.locator('#peers article.self').waitFor();
}

const test = base.extend({
    server: async ({}, use) => {
        const { server, url } = await startServer();
        await use({ server, url });
        await new Promise(resolve => server.close(resolve));
    },

    page: async ({ browser, server }, use) => {
        const context = await browser.newContext({
            baseURL: server.url,
            permissions: ['microphone'],
        });
        const page = await context.newPage();
        await use(page);
        await context.close();
    },

    connectUser: async ({ browser, server }, use) => {
        await use(async () => {
            const context = await browser.newContext({
                baseURL: server.url,
                permissions: ['microphone'],
            });
            const page = await context.newPage();
            await page.addInitScript(() => {
                const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = async (constraints) => {
                    const stream = await orig(constraints);
                    window.localStream = stream;
                    return stream;
                };
            });
            const connected = waitForConnect(page);
            await page.goto('/');
            await connected;
            return { context, page };
        });
    },
});

export { test, expect, waitForConnect };
