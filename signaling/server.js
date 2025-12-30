const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New client connected');
    let currentUser = null;
    let currentRoom = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data.type);

            switch (data.type) {
                case 'join-room':
                    handleJoinRoom(ws, data);
                    break;
                case 'leave-room':
                    handleLeaveRoom(data);
                    break;
                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    forwardToUser(data);
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        if (currentRoom && currentUser) {
            handleLeaveRoom({ roomId: currentRoom, userId: currentUser });
        }
    });

    function handleJoinRoom(ws, data) {
        const { roomId, userId } = data;
        
        currentUser = userId;
        currentRoom = roomId;

        // Initialize room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
        }

        const room = rooms.get(roomId);
        
        // Add user to room
        room.set(userId, ws);
        
        // Notify user of existing users
        const users = Array.from(room.keys());
        ws.send(JSON.stringify({
            type: 'room-joined',
            roomId: roomId,
            users: users.filter(id => id !== userId)
        }));

        // Notify other users
        users.forEach(existingUserId => {
            if (existingUserId !== userId) {
                const existingUserWs = room.get(existingUserId);
                if (existingUserWs) {
                    existingUserWs.send(JSON.stringify({
                        type: 'user-joined',
                        userId: userId
                    }));
                }
            }
        });

        console.log(`User ${userId} joined room ${roomId}`);
    }

    function handleLeaveRoom(data) {
        const { roomId, userId } = data;
        
        if (!rooms.has(roomId)) return;
        
        const room = rooms.get(roomId);
        room.delete(userId);

        // Remove room if empty
        if (room.size === 0) {
            rooms.delete(roomId);
        } else {
            // Notify remaining users
            room.forEach((userWs, existingUserId) => {
                userWs.send(JSON.stringify({
                    type: 'user-left',
                    userId: userId
                }));
            });
        }

        console.log(`User ${userId} left room ${roomId}`);
    }

    function forwardToUser(data) {
        const { targetUserId, roomId } = data;
        
        if (!rooms.has(roomId)) return;
        
        const room = rooms.get(roomId);
        const targetWs = room.get(targetUserId);
        
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(JSON.stringify(data));
        }
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});