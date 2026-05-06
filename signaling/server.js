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

const ADJECTIVES = ['Adorable','Brave','Calm','Charming','Cheerful','Clever',
    'Curious','Dazzling','Eager','Elegant','Fancy','Fearless','Gentle','Happy',
    'Jolly','Joyful','Kind','Lively','Lucky','Merry','Mighty','Noble','Peaceful',
    'Playful','Polite','Proud','Quiet','Resourceful','Silly','Sincere','Spirited',
    'Splendid','Sturdy','Swift','Thoughtful','Valiant','Wise','Witty','Zany',
    'Bold','Bright','Cozy','Daring','Graceful','Humble','Keen','Loyal','Neat',
    'Plucky','Steady'];

const NOUNS = ['Ant','Badger','Bear','Bee','Bird','Bobcat','Buffalo','Butterfly',
    'Camel','Cat','Cheetah','Chicken','Cobra','Cod','Crane','Crow','Deer','Dingo',
    'Dolphin','Dove','Dragon','Eagle','Elephant','Falcon','Flamingo','Fox','Frog',
    'Gazelle','Giraffe','Goat','Goose','Hawk','Heron','Horse','Hummingbird','Ibis',
    'Jaguar','Jay','Koala','Lark','Leopard','Lion','Llama','Lynx','Mantis','Marten',
    'Mink','Monkey','Moose','Moth','Newt','Ocelot','Oriole','Otter','Owl','Panther',
    'Parrot','Pelican','Penguin','Pheasant','Pigeon','Pony','Puffin','Quail','Rabbit',
    'Raven','Robin','Salmon','Seal','Shark','Sheep','Sparrow','Spider','Stork',
    'Swan','Tiger','Toad','Trout','Tuna','Turtle','Viper','Vulture','Walrus','Whale',
    'Wolf','Wolverine','Wombat','Woodpecker','Wren','Yak','Zebra','Beetle','Bison',
    'Caribou','Coyote','Finch','Grouse','Hare','Kingfisher'];

function generateName(connections) {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const base = `${adjective} ${noun}`;
    const taken = new Set([...connections.values()].map(c => c.name));
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base} ${suffix}`)) suffix++;
    return `${base} ${suffix}`;
}

export function createServer({ port = 8080, server = null } = {}) {
    const connections = new Map();

    const wss = server
        ? new WebSocketServer({ server, path: '/ws/' })
        : new WebSocketServer({ port });

    wss.on('connection', (ws) => {

        const id = uuidv4();
        const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        const name = generateName(connections);

        ws.send(JSON.stringify({
            "type": "welcome",
            "id": id,
            "emoji": emoji,
            "name": name,
            "peers": [...connections.entries()].map(([peerId, conn]) => ({ id: peerId, emoji: conn.emoji, name: conn.name })),
        }))

        connections.forEach((conn) => {
            conn.ws.send(JSON.stringify({
                "type": "user-joined",
                "user": id,
                "emoji": emoji,
                "name": name,
            }))
        })

        connections.set(id, { ws, emoji, name });

        console.log('New client connected', id);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Received:', data);
                if (data.type === 'rename') {
                    const conn = connections.get(id);
                    let changed = false;
                    if (typeof data.name === 'string' && data.name.length > 0 && data.name.length <= 64) {
                        conn.name = data.name;
                        changed = true;
                    }
                    if (typeof data.emoji === 'string' && data.emoji.length > 0 && data.emoji.length <= 32) {
                        conn.emoji = data.emoji;
                        changed = true;
                    }
                    if (!changed) return;
                    const update = JSON.stringify({
                        type: 'user-renamed',
                        user: id,
                        name: conn.name,
                        emoji: conn.emoji,
                    });
                    connections.forEach((c) => c.ws.send(update));
                } else if (data.target) {
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
