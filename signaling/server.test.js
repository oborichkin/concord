import { createHmac } from 'crypto';
import WebSocket from 'ws';
import { createServer } from './server.js';

const log = console.log.bind(console);
const error = console.error.bind(console);

let captured = [];
let capturing = false;
console.log = (...args) => { if (capturing) captured.push({ level: 'log', args }); };
console.error = (...args) => { if (capturing) captured.push({ level: 'error', args }); };

let passed = 0;
let failed = 0;
const failures = [];

function assertEqual(actual, expected, label) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function onceListening(wss) {
    return new Promise((resolve) => {
        if (wss.address()) return resolve();
        wss.on('listening', resolve);
    });
}

function connect(port) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        const queue = [];
        let resolver = null;
        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (resolver) {
                resolver(msg);
                resolver = null;
            } else {
                queue.push(msg);
            }
        });
        ws.on('open', () => resolve({
            ws,
            recv() {
                if (queue.length > 0) return Promise.resolve(queue.shift());
                return new Promise((r) => { resolver = r; });
            }
        }));
        ws.on('error', reject);
    });
}

function close(ws) {
    return new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.on('close', resolve);
    });
}

async function pollUntil(fn, { interval = 10, multiplier = 1.5, maxAttempts = 20 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
        if (fn()) return;
        await new Promise((r) => setTimeout(r, interval));
        interval *= multiplier;
    }
    throw new Error('pollUntil: condition not met within timeout');
}

async function check(name, fn) {
    captured = [];
    capturing = true;
    try {
        await fn();
        log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        log(`  ✖ ${name}`);
        failures.push({ name, err, captured: [...captured] });
        failed++;
    }
    capturing = false;
}

async function run() {
    const server = createServer({ port: 0 });
    await onceListening(server.wss);
    const port = server.wss.address().port;

    log('connection:');
    await check('sends welcome with id, emoji, name, and empty peers', async () => {
        const c = await connect(port);
        const msg = await c.recv();
        assertEqual(msg.type, 'welcome', 'type');
        assertEqual(typeof msg.id, 'string', 'id');
        assertEqual(typeof msg.emoji, 'string', 'emoji type');
        assertEqual(msg.emoji.length > 0, true, 'emoji non-empty');
        assertEqual(typeof msg.name, 'string', 'name type');
        assertEqual(msg.name.length > 0, true, 'name non-empty');
        assertEqual(msg.peers, [], 'peers');
        c.ws.close();
        await close(c.ws);
    });

    await check('sends welcome with existing peers including emoji and name', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        assertEqual(w2.peers, [{ id: w1.id, emoji: w1.emoji, name: w1.name }], 'peers');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('notifies existing peers when user joins with emoji and name', async () => {
        const c1 = await connect(port);
        await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        const joined = await c1.recv();
        assertEqual(joined.type, 'user-joined', 'type');
        assertEqual(joined.user, w2.id, 'user');
        assertEqual(joined.emoji, w2.emoji, 'emoji');
        assertEqual(joined.name, w2.name, 'name');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('assigns different emojis across connections', async () => {
        const emojis = new Set();
        for (let i = 0; i < 20; i++) {
            const c = await connect(port);
            const msg = await c.recv();
            emojis.add(msg.emoji);
            c.ws.close();
            await close(c.ws);
        }
        assertEqual(emojis.size > 1, true, 'multiple emojis');
    });

    await check('assigns unique names across concurrent connections', async () => {
        const clients = [];
        const names = [];
        for (let i = 0; i < 20; i++) {
            const c = await connect(port);
            const msg = await c.recv();
            names.push(msg.name);
            clients.push(c);
        }
        assertEqual(new Set(names).size, names.length, 'all names unique');
        for (const c of clients) {
            c.ws.close();
            await close(c.ws);
        }
    });

    await check('name follows Adjective Noun format', async () => {
        const c = await connect(port);
        const msg = await c.recv();
        assertEqual(/^[A-Z][a-z]+ [A-Z][a-z]+( \d+)?$/.test(msg.name), true, 'name format');
        c.ws.close();
        await close(c.ws);
    });

    log('targeted messaging:');
    await check('sends targeted message to specific peer', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        await c1.recv();
        c2.ws.send(JSON.stringify({ target: w1.id, type: 'offer', sdp: 'fake-sdp' }));
        const received = await c1.recv();
        assertEqual(received.type, 'offer', 'type');
        assertEqual(received.sdp, 'fake-sdp', 'sdp');
        assertEqual(received.user, w2.id, 'user');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    log('offer/answer/ice exchange:');
    await check('forwards answer to correct peer', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        await c1.recv();
        c1.ws.send(JSON.stringify({ target: w2.id, type: 'answer', sdp: 'fake-answer-sdp' }));
        const received = await c2.recv();
        assertEqual(received.type, 'answer', 'type');
        assertEqual(received.sdp, 'fake-answer-sdp', 'sdp');
        assertEqual(received.user, w1.id, 'user');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('forwards ice candidate to correct peer', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        await c1.recv();
        c2.ws.send(JSON.stringify({
            target: w1.id,
            type: 'ice-candidate',
            candidate: { candidate: 'fake-candidate', sdpMid: '0', sdpMLineIndex: 0 },
        }));
        const received = await c1.recv();
        assertEqual(received.type, 'ice-candidate', 'type');
        assertEqual(received.candidate.candidate, 'fake-candidate', 'candidate');
        assertEqual(received.user, w2.id, 'user');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('full offer/answer/ice exchange between two peers', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        await c1.recv();

        c1.ws.send(JSON.stringify({ target: w2.id, type: 'offer', sdp: 'offer-sdp' }));
        const offer = await c2.recv();
        assertEqual(offer.type, 'offer', 'offer type');
        assertEqual(offer.sdp, 'offer-sdp', 'offer sdp');
        assertEqual(offer.user, w1.id, 'offer sender');

        c2.ws.send(JSON.stringify({ target: w1.id, type: 'answer', sdp: 'answer-sdp' }));
        const answer = await c1.recv();
        assertEqual(answer.type, 'answer', 'answer type');
        assertEqual(answer.sdp, 'answer-sdp', 'answer sdp');
        assertEqual(answer.user, w2.id, 'answer sender');

        c1.ws.send(JSON.stringify({
            target: w2.id,
            type: 'ice-candidate',
            candidate: { candidate: 'c1-candidate', sdpMid: '0' },
        }));
        const ice1 = await c2.recv();
        assertEqual(ice1.type, 'ice-candidate', 'ice from c1 type');
        assertEqual(ice1.candidate.candidate, 'c1-candidate', 'ice from c1 candidate');
        assertEqual(ice1.user, w1.id, 'ice from c1 sender');

        c2.ws.send(JSON.stringify({
            target: w1.id,
            type: 'ice-candidate',
            candidate: { candidate: 'c2-candidate', sdpMid: '0' },
        }));
        const ice2 = await c1.recv();
        assertEqual(ice2.type, 'ice-candidate', 'ice from c2 type');
        assertEqual(ice2.candidate.candidate, 'c2-candidate', 'ice from c2 candidate');
        assertEqual(ice2.user, w2.id, 'ice from c2 sender');

        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    log('broadcast messaging:');
    await check('broadcasts message to all other peers', async () => {
        const c1 = await connect(port);
        await c1.recv();
        const c2 = await connect(port);
        await c2.recv();
        await c1.recv();
        const c3 = await connect(port);
        await c3.recv();
        await c1.recv();
        await c2.recv();
        c1.ws.send(JSON.stringify({ type: 'chat', text: 'hello' }));
        const msg2 = await c2.recv();
        const msg3 = await c3.recv();
        assertEqual(msg2.type, 'chat', 'type');
        assertEqual(msg2.text, 'hello', 'text');
        assertEqual(msg3.type, 'chat', 'type');
        assertEqual(msg3.text, 'hello', 'text');
        c1.ws.close();
        c2.ws.close();
        c3.ws.close();
        await close(c1.ws);
        await close(c2.ws);
        await close(c3.ws);
    });

    log('disconnection:');
    await check('removes peer and notifies others', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        await c2.recv();
        await c1.recv();
        c1.ws.close();
        await close(c1.ws);
        const left = await c2.recv();
        assertEqual(left.type, 'user-left', 'type');
        assertEqual(left.user, w1.id, 'user');
        assertEqual(server.connections.size, 1, 'connections');
        c2.ws.close();
        await close(c2.ws);
    });

    log('rename:');
    await check('renames name and broadcasts to all peers', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        await c2.recv();
        await c1.recv();
        c1.ws.send(JSON.stringify({ type: 'user-renamed', name: 'New Name' }));
        const renamed = await c2.recv();
        assertEqual(renamed.type, 'user-renamed', 'type');
        assertEqual(renamed.user, w1.id, 'user');
        assertEqual(renamed.name, 'New Name', 'name');
        assertEqual(renamed.emoji, undefined, 'emoji not sent');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('renames emoji and broadcasts to all peers', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        await c2.recv();
        await c1.recv();
        c1.ws.send(JSON.stringify({ type: 'user-renamed', emoji: '🐉' }));
        const renamed = await c2.recv();
        assertEqual(renamed.type, 'user-renamed', 'type');
        assertEqual(renamed.emoji, '🐉', 'emoji');
        assertEqual(renamed.name, undefined, 'name not sent');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('renames both name and emoji at once', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        await c2.recv();
        await c1.recv();
        c1.ws.send(JSON.stringify({ type: 'user-renamed', name: 'Cool Cat', emoji: '😺' }));
        const renamed = await c2.recv();
        assertEqual(renamed.name, 'Cool Cat', 'name');
        assertEqual(renamed.emoji, '😺', 'emoji');
        assertEqual(server.connections.get(w1.id).name, 'Cool Cat', 'stored name');
        assertEqual(server.connections.get(w1.id).emoji, '😺', 'stored emoji');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('allows duplicate names', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        await c1.recv();
        c2.ws.send(JSON.stringify({ type: 'user-renamed', name: w1.name }));
        const r1 = await c1.recv();
        assertEqual(r1.name, w1.name, 'duplicate name broadcast');
        assertEqual(r1.user, w2.id, 'user');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    log('error handling:');
    await check('does not crash on malformed JSON', async () => {
        const c = await connect(port);
        await c.recv();
        c.ws.send('not valid json');
        await pollUntil(() => c.ws.readyState === WebSocket.OPEN);
        assertEqual(c.ws.readyState, WebSocket.OPEN, 'readyState');
        c.ws.close();
        await close(c.ws);
    });

    await check('does not crash on message to unknown target', async () => {
        const c = await connect(port);
        await c.recv();
        c.ws.send(JSON.stringify({ target: 'nonexistent-id', type: 'offer' }));
        await pollUntil(() => c.ws.readyState === WebSocket.OPEN);
        assertEqual(c.ws.readyState, WebSocket.OPEN, 'readyState');
        c.ws.close();
        await close(c.ws);
    });

    log('ice servers:');
    await check('includes iceServers with STUN fallback when no TURN env vars', async () => {
        const c = await connect(port);
        const msg = await c.recv();
        assertEqual(Array.isArray(msg.iceServers), true, 'iceServers is array');
        assertEqual(msg.iceServers.length >= 1, true, 'has at least one server');
        assertEqual(msg.iceServers[0].urls, 'stun:stun.l.google.com:19302', 'stun fallback');
        c.ws.close();
        await close(c.ws);
    });

    await check('includes TURN servers with credentials when env vars are set', async () => {
        const secretServer = createServer({ port: 0 });
        await onceListening(secretServer.wss);
        const secretPort = secretServer.wss.address().port;

        const originalSecret = process.env.TURN_SECRET;
        const originalDomain = process.env.TURN_DOMAIN;
        process.env.TURN_SECRET = 'test-secret';
        process.env.TURN_DOMAIN = 'turn.example.com';

        try {
            const c = await connect(secretPort);
            const msg = await c.recv();
            assertEqual(Array.isArray(msg.iceServers), true, 'iceServers is array');
            assertEqual(msg.iceServers.length, 4, '4 servers (1 stun + 3 turn)');

            assertEqual(msg.iceServers[0].urls, 'stun:stun.l.google.com:19302', 'stun');

            assertEqual(msg.iceServers[1].urls, 'turn:turn.example.com:3478?transport=udp', 'turn udp');
            assertEqual(msg.iceServers[2].urls, 'turn:turn.example.com:3478?transport=tcp', 'turn tcp');
            assertEqual(msg.iceServers[3].urls, 'turns:turn.example.com:5349?transport=tcp', 'turns tcp');

            const turnEntry = msg.iceServers[1];
            assertEqual(typeof turnEntry.username, 'string', 'username is string');
            assertEqual(typeof turnEntry.credential, 'string', 'credential is string');
            assertEqual(turnEntry.username.endsWith(':concord'), true, 'username suffix');

            const expiry = parseInt(turnEntry.username.split(':')[0], 10);
            const now = Math.floor(Date.now() / 1000);
            assertEqual(expiry > now, true, 'expiry is in the future');
            assertEqual(expiry <= now + 86400, true, 'expiry within 24h');

            const hmac = createHmac('sha1', 'test-secret');
            hmac.update(turnEntry.username);
            assertEqual(turnEntry.credential, hmac.digest('base64'), 'credential matches HMAC');

            assertEqual(turnEntry.credential, msg.iceServers[2].credential, 'same credential across entries');
            assertEqual(turnEntry.username, msg.iceServers[3].username, 'same username across entries');

            c.ws.close();
            await close(c.ws);
        } finally {
            process.env.TURN_SECRET = originalSecret;
            process.env.TURN_DOMAIN = originalDomain;
            for (const conn of secretServer.connections.values()) conn.ws.close();
            await new Promise((resolve) => secretServer.wss.close(resolve));
        }
    });

    if (failures.length > 0) {
        log('\n--- failure details ---\n');
        for (const { name, err, captured } of failures) {
            log(`✖ ${name}`);
            log(`  ${err.message}`);
            if (captured.length > 0) {
                log('  server output:');
                for (const entry of captured) {
                    const fn = entry.level === 'error' ? error : log;
                    fn('   ', ...entry.args);
                }
            }
            log('');
        }
    }

    for (const conn of server.connections.values()) conn.ws.close();
    await new Promise((resolve) => server.wss.close(resolve));

    log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
