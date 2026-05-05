import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';

export function createServer({ port = 8080, server = null } = {}) {
    const connections = new Map();

    const wss = server
        ? new WebSocketServer({ server, path: '/ws/' })
        : new WebSocketServer({ port });

    wss.on('connection', (ws) => {

        const id = uuidv4();

        ws.send(JSON.stringify({
            "type": "welcome",
            "id": id,
            "peers": [...connections.keys()],
        }))

        connections.forEach((conn) => {
            conn.send(JSON.stringify({
                "type": "user-joined",
                "user": id,
            }))
        })

        connections.set(id, ws);

        console.log('New client connected', id);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Received:', data);
                if (data.target) {
                    const { target, ...messageData } = data;
                    messageData.user = id;
                    const targetConn = connections.get(target);
                    if (targetConn) targetConn.send(JSON.stringify(messageData))
                } else {
                    connections
                        .forEach((conn, key) => {
                            if (key != id) conn.send(message);
                        })
                }
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });

        ws.on('close', () => {
            console.log('Client disconnected');
            connections.delete(id)
            connections.forEach((conn) => {
                conn.send(JSON.stringify({
                    "type": "user-left",
                    "user": id,
                }))
            })
        });
    });

    return { wss, connections };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    createServer();
}
