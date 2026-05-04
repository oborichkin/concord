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
    await check('sends welcome with id and empty peers', async () => {
        const c = await connect(port);
        const msg = await c.recv();
        assertEqual(msg.type, 'welcome', 'type');
        assertEqual(typeof msg.id, 'string', 'id');
        assertEqual(msg.peers, [], 'peers');
        c.ws.close();
        await close(c.ws);
    });

    await check('sends welcome with existing peer IDs', async () => {
        const c1 = await connect(port);
        const w1 = await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        assertEqual(w2.peers, [w1.id], 'peers');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
    });

    await check('notifies existing peers when user joins', async () => {
        const c1 = await connect(port);
        await c1.recv();
        const c2 = await connect(port);
        const w2 = await c2.recv();
        const joined = await c1.recv();
        assertEqual(joined.type, 'user-joined', 'type');
        assertEqual(joined.user, w2.id, 'user');
        c1.ws.close();
        c2.ws.close();
        await close(c1.ws);
        await close(c2.ws);
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

    log('error handling:');
    await check('does not crash on malformed JSON', async () => {
        const c = await connect(port);
        await c.recv();
        c.ws.send('not valid json');
        await new Promise((r) => setTimeout(r, 200));
        assertEqual(c.ws.readyState, WebSocket.OPEN, 'readyState');
        c.ws.close();
        await close(c.ws);
    });

    await check('does not crash on message to unknown target', async () => {
        const c = await connect(port);
        await c.recv();
        c.ws.send(JSON.stringify({ target: 'nonexistent-id', type: 'offer' }));
        await new Promise((r) => setTimeout(r, 200));
        assertEqual(c.ws.readyState, WebSocket.OPEN, 'readyState');
        c.ws.close();
        await close(c.ws);
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

    for (const ws of server.connections.values()) ws.close();
    await new Promise((resolve) => server.wss.close(resolve));

    log(`${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

run();
