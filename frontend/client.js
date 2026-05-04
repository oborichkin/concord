const ICE_SERVERS = [
    { urls: 'stun:l.google.com:19302' },
    { urls: 'stun:89.104.67.110:3478' },
];
const CONNECTION_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/`;

// Objects
let localStream = null;
let signalingSocket = null;


let peers = new Map();

class Peer {

    constructor(id) {
        // Basic
        this.id = id;
        // DOM
        // TODO причесать
        this.element = document.createElement("div");
        this.element.appendChild(document.createTextNode(this.id));
        this.audioElement = document.createElement("audio");
        this.audioElement.controls = true
        this.audioElement.autoplay = true
        this.element.appendChild(this.audioElement);
        peersDiv.appendChild(this.element);
        // Peer
        this.pc = new RTCPeerConnection({iceServers: ICE_SERVERS});
        localStream.getAudioTracks().forEach(track => this.pc.addTrack(track));

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                signalingSocket.send(JSON.stringify({
                    type: 'ice-candidate',
                    target: this.id,
                    candidate: event.candidate.toJSON()
                }))
            }
        }

        this.pc.ontrack = (event) => {
            this.audioElement.srcObject = event.streams[0] || new MediaStream([event.track]);
            this.audioElement.volume = 1
            this.audioElement.play()
                .catch((reason) => {})
        }
    }

    destroy() {
        this.pc.close()
        this.element.remove()
    }

    async handleOffer(offer) {
        await this.pc.setRemoteDescription(offer)
        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)
        answer.target = this.id
        signalingSocket.send(JSON.stringify(answer))
    }

    async addIceCandidate(candidate) {
        await this.pc.addIceCandidate(candidate)
    }

    async handleAnswer(answer) {
        await this.pc.setRemoteDescription(answer)
    }
}

// DOM Elements
let peersDiv = document.getElementById('peers');

async function handleMessage(message) {
    console.log('Received message:', message);
    switch (message.type) {
        case "welcome":
            message.peers.forEach(id => {
                const peer = new Peer(id)
                peers.set(id, peer)
                peer.pc.createOffer()
                    .then((offer) => {
                        peer.pc.setLocalDescription(offer)
                            .then(() => {
                                offer.target = id;
                                signalingSocket.send(JSON.stringify(offer))
                            })
                    })
            });
            break;
        case "user-left":
            peers.get(message.user).destroy();
            peers.delete(message.user);
            break;
        case "user-joined":
            peers.set(message.user, new Peer(message.user));
            break;
        case "offer":
            await peers.get(message.user).handleOffer(message);
            break;
        case "answer":
            await peers.get(message.user).handleAnswer(message);
            break;
        case "ice-candidate":
            await peers.get(message.user).addIceCandidate(message.candidate);
            break;
        default:
            // console.warn("Unexpected message", message);
            break;
    }
}

async function connect() {

    // Stream setup
    navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
        video: false,
    })
        .then((stream) => {
            localStream = stream;
            // Signaling socket setup
            signalingSocket = new WebSocket(CONNECTION_URL);
            signalingSocket.onopen = () => {
                console.log('Connected to signaling server');
            }
            signalingSocket.onerror = (error) => {
                console.error('Signaling error:', error);
            }
            signalingSocket.onclose = () => {
                console.log('Signaling connection closed');
            }
            signalingSocket.onmessage = async (event) => {
                const message = JSON.parse(event.data);
                await handleMessage(message);
            }
        })
        .catch((error) => {
            console.error(error)
        })
}

connect()