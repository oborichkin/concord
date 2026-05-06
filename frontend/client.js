const ICE_SERVERS = [
    { urls: 'stun:l.google.com:19302' },
    { urls: 'stun:89.104.67.110:3478' },
];
const CONNECTION_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/`;

// Objects
let localStream = null;
let signalingSocket = null;

let peers = new Map();
let selfUser = null;
let peersDiv = document.getElementById('peers');

class PeerBase {
    constructor(templateId) {
        const node = document.getElementById(templateId).content.cloneNode(true);
        this.element = node.querySelector("article");
    }

    set name(value) {
        this._name = value;
        this.element.querySelector(".peer-name").textContent = value;
    }

    get name() {
        return this._name;
    }

    set emoji(value) {
        this._emoji = value;
        this.element.querySelector(".peer-emoji").textContent = value;
    }

    get emoji() {
        return this._emoji;
    }
}

class Self extends PeerBase {
    constructor(id, emoji, name) {
        super("self-template");
        this.id = id;
        this.emoji = emoji;
        this.name = name;
        peersDiv.prepend(this.element);
        const muteBtn = this.element.querySelector(".mute-btn");
        muteBtn.addEventListener("click", () => {
            const muted = muteBtn.textContent === "Mute";
            localStream.getAudioTracks().forEach(track => track.enabled = !muted);
            muteBtn.textContent = muted ? "Unmute" : "Mute";
        });

        const emojiEl = this.element.querySelector(".peer-emoji");
        const nameEl = this.element.querySelector(".peer-name");
        emojiEl.addEventListener("click", () => this._editField("emoji", emojiEl));
        nameEl.addEventListener("click", () => this._editField("name", nameEl));
    }

    _editField(field, el) {
        if (el.querySelector("input")) return;
        const currentValue = this[`_${field}`];
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentValue;
        input.maxLength = field === "name" ? 64 : 32;
        el.textContent = "";
        el.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            const value = input.value.trim();
            if (value && value !== currentValue) {
                this[field] = value;
                signalingSocket.send(JSON.stringify({ type: "rename", [field]: value }));
            } else {
                el.textContent = currentValue;
            }
        };

        input.addEventListener("blur", commit, { once: true });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
            if (e.key === "Escape") { input.value = currentValue; input.blur(); }
        });
    }
}

class Peer extends PeerBase {

    constructor(id, emoji, name) {
        super("peer-template");
        this.id = id;
        this.emoji = emoji;
        this.name = name;
        this.audioElement = this.element.querySelector("audio");
        this.muteBtn = this.element.querySelector(".mute-btn");
        this.volumeSlider = this.element.querySelector(".volume");

        this.muteBtn.addEventListener("click", () => {
            this.audioElement.muted = !this.audioElement.muted;
            this.muteBtn.textContent = this.audioElement.muted ? "Unmute" : "Mute";
        });

        this.volumeSlider.addEventListener("input", () => {
            this.audioElement.volume = this.volumeSlider.value;
        });

        peersDiv.appendChild(this.element);
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
            this.audioElement.play()
                .catch((reason) => {})
        }
    }

    destroy() {
        this.pc.close()
        this.element.remove()
    }

    async createAndSendOffer() {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        offer.target = this.id;
        signalingSocket.send(JSON.stringify(offer));
    }

    async handleOffer(offer) {
        await this.pc.setRemoteDescription(offer);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        answer.target = this.id;
        signalingSocket.send(JSON.stringify(answer));
    }

    async addIceCandidate(candidate) {
        await this.pc.addIceCandidate(candidate);
    }

    async handleAnswer(answer) {
        await this.pc.setRemoteDescription(answer);
    }
}

async function handleMessage(message) {
    console.log('Received message:', message);
    switch (message.type) {
        case "welcome":
            selfUser = new Self(message.id, message.emoji, message.name);
            message.peers.forEach(peer => {
                const p = new Peer(peer.id, peer.emoji, peer.name);
                peers.set(peer.id, p);
                p.createAndSendOffer().catch(console.error);
            });
            break;
        case "user-left":
            peers.get(message.user).destroy();
            peers.delete(message.user);
            break;
        case "user-joined":
            peers.set(message.user, new Peer(message.user, message.emoji, message.name));
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
        case "user-renamed":
            if (selfUser && message.user === selfUser.id) {
                selfUser._name = message.name;
                selfUser._emoji = message.emoji;
                const nameEl = selfUser.element.querySelector(".peer-name");
                const emojiEl = selfUser.element.querySelector(".peer-emoji");
                if (!nameEl.querySelector("input")) nameEl.textContent = message.name;
                if (!emojiEl.querySelector("input")) emojiEl.textContent = message.emoji;
            } else {
                const peer = peers.get(message.user);
                if (peer) {
                    peer.name = message.name;
                    peer.emoji = message.emoji;
                }
            }
            break;
        default:
            // console.warn("Unexpected message", message);
            break;
    }
}

async function connect() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false,
        });
        localStream = stream;
        window.localStream = stream;

        signalingSocket = new WebSocket(CONNECTION_URL);
        signalingSocket.onopen = () => {
            console.log('Connected to signaling server');
        };
        signalingSocket.onerror = (error) => {
            console.error('Signaling error:', error);
        };
        signalingSocket.onclose = () => {
            console.log('Signaling connection closed');
        };
        signalingSocket.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            await handleMessage(message);
        };
    } catch (error) {
        console.error(error);
    }
}

connect()

const themeStylesheet = document.getElementById('theme-stylesheet');
const themeSelector = document.getElementById('theme-selector');

function setTheme(name) {
    themeStylesheet.href = `themes/${name}.css`;
    localStorage.setItem('theme', name);
    themeSelector.value = name;
}

themeSelector.addEventListener('change', (e) => setTheme(e.target.value));

const available = [...themeSelector.options].map(o => o.value);
const savedTheme = localStorage.getItem('theme') || 'default';
setTheme(available.includes(savedTheme) ? savedTheme : 'default');