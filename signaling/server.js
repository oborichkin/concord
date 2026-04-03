import { v4 as uuidv4 } from 'uuid'; // Import UUID generator
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const connections = new Set();

wss.on('connection', (ws) => {

    ws.id = uuidv4();

    ws.send(JSON.stringify({
        "type": "welcome",
        "you": ws.id,
        "peers": [...connections].map((conn) => conn.id),
    }))

    connections.forEach((conn) => {
        conn.send(JSON.stringify({
            "type": "user-joined",
            "user": ws.id,
        }))
    })

    connections.add(ws);

    console.log('New client connected', ws);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);
            connections
                .filter((conn) => conn.id != ws.id)
                .forEach((conn) => conn.send(data))
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        connections.delete(ws)
        connections.forEach((conn) => {
            conn.send(JSON.stringify({
                "type": "user-left",
                "user": ws.id,
            }))
        })
    });
});
