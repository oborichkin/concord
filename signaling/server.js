import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';
import { createHmac } from 'crypto';

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

function getIceServers() {
    const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const secret = process.env.TURN_SECRET;
    const domain = process.env.TURN_DOMAIN;
    if (secret && domain) {
        const expiry = Math.floor(Date.now() / 1000) + 86400;
        const username = `${expiry}:concord`;
        const hmac = createHmac('sha1', secret);
        hmac.update(username);
        const credential = hmac.digest('base64');
        servers.push(
            { urls: `turn:${domain}:3478?transport=udp`, username, credential },
            { urls: `turn:${domain}:3478?transport=tcp`, username, credential },
            { urls: `turns:${domain}:5349?transport=tcp`, username, credential },
        );
    }
    return servers;
}

class Connection {
    constructor (ws, name, emoji) {
        this.ws = ws;
        this.name = name;
        this.emoji = emoji;
    }
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
            type: "welcome",
            id: id,
            emoji: emoji,
            name: name,
            peers: [...connections.entries()].map(([peerId, conn]) => ({ id: peerId, emoji: conn.emoji, name: conn.name })),
            iceServers: getIceServers(),
        }));

        connections.forEach((conn) => {
            conn.ws.send(JSON.stringify({
                type: "user-joined",
                user: id,
                emoji: emoji,
                name: name,
            }));
        });

        const connection = new Connection(ws, name, emoji);
        connections.set(id, connection);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                let out = {...data, user: id};

                if (data.type === "user-renamed") {
                    connection.name = data.name ?? connection.name;
                    connection.emoji = data.emoji ?? connection.emoji;
                }


                if (data.target) {
                    const { target, ...messageData } = out;
                    const targetConn = connections.get(target);
                    const json = JSON.stringify(messageData);
                    if (targetConn) targetConn.ws.send(json);
                } else {
                    const json = JSON.stringify(out);
                    connections.forEach((c, key) => {
                        if (key !== id) c.ws.send(json);
                    });
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }
        });

        ws.on('close', () => {
            connections.delete(id);
            connections.forEach((conn) => {
                conn.ws.send(JSON.stringify({
                    type: "user-left",
                    user: id,
                }));
            });
        });
    });

    return { wss, connections };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    createServer();
}
