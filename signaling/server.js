import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';

const EMOJIS = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯',
                '🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆',
                '🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛',
                '🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷️',
                '🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞',
                '🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅',
                '🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒',
                '🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙',
                '🐐','🦌','🐕','🐩','🦮','🐈','🪶','🐓','🦃','🦤',
                '🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫'];

export function createServer({ port = 8080, server = null } = {}) {
    const connections = new Map();

    const wss = server
        ? new WebSocketServer({ server, path: '/ws/' })
        : new WebSocketServer({ port });

    wss.on('connection', (ws) => {

        const id = uuidv4();
        const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

        ws.send(JSON.stringify({
            "type": "welcome",
            "id": id,
            "emoji": emoji,
            "peers": [...connections.entries()].map(([peerId, conn]) => ({ id: peerId, emoji: conn.emoji })),
        }))

        connections.forEach((conn) => {
            conn.ws.send(JSON.stringify({
                "type": "user-joined",
                "user": id,
                "emoji": emoji,
            }))
        })

        connections.set(id, { ws, emoji });

        console.log('New client connected', id);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Received:', data);
                if (data.target) {
                    const { target, ...messageData } = data;
                    messageData.user = id;
                    const targetConn = connections.get(target);
                    if (targetConn) targetConn.ws.send(JSON.stringify(messageData))
                } else {
                    connections
                        .forEach((conn, key) => {
                            if (key != id) conn.ws.send(message);
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
                conn.ws.send(JSON.stringify({
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
