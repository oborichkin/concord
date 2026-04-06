import { v4 as uuidv4 } from 'uuid'; // Import UUID generator
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });
const connections = new Map();

wss.on('connection', (ws) => {

    const id = uuidv4();

    ws.send(JSON.stringify({
        "type": "welcome",
        "peers": [...connections.keys()],
    }))

    connections.forEach((conn) => {
        conn.send(JSON.stringify({
            "type": "user-joined",
            "user": id,
        }))
    })

    connections.set(id, ws);

    console.log('New client ababa connected', id);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);
            if (data.target) {
                // Targeted message
                const { target, ...messageData } = data;
                messageData.user = id;
                connections.get(target).send(JSON.stringify(messageData))
            } else {
                // Broadcast message
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
