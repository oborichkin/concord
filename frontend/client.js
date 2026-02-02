const ICE_SERVERS = [
    { urls: 'stun:89.104.67.110:3478' },
];
const CONNECTION_URL = `ws://${window.location.host}/ws/`;

// Objects
let localStream = null;
let peers = {};
let signalingSocket = null;

// DOM Elements
let localAudio = document.getElementById('localAudio');

function handleMessage(message) {
    console.log('Received message:', message);
}

async function connect() {
    // Signaling socket setup
    signalingSocket = new WebSocket(CONNECTION_URL);
    signalingSocket.onopen = () => {
        console.log('Connected to signaling server');
        // TODO: update status in DOM
    }
    signalingSocket.onerror = (error) => {
        console.error('Signaling error:', error);
    }
    signalingSocket.onclose = () => {
        console.log('Signaling connection closed');
    }
    signalingSocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleMessage(message);
    }

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
            localAudio.srcObject = stream;
        })
        .catch((error) => {
            console.error(error)
        })

}

connect()