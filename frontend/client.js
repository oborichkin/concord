const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
];
let iceServers = ICE_SERVERS;
const CONNECTION_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/`;

// Objects
let localStream = null;
let signalingSocket = null;

let peers = new Map();
let selfUser = null;
let peersDiv = document.getElementById('peers');

class PeerBase {
    constructor(templateId, { id, emoji, name, prepend } = {}) {
        const node = document.getElementById(templateId).content.cloneNode(true);
        this.element = node.querySelector("article");
        this.id = id;
        this.emoji = emoji;
        this.name = name;
        this.muteBtn = this.element.querySelector(".mute-btn");
        this.muteBtn.addEventListener("click", () => this._onMuteClick());
        peersDiv[prepend ? "prepend" : "append"](this.element);
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
        super("self-template", { id, emoji, name, prepend: true });
        const emojiEl = this.element.querySelector(".peer-emoji");
        const nameEl = this.element.querySelector(".peer-name");
        emojiEl.addEventListener("click", () => this._openEmojiPicker(emojiEl));
        nameEl.addEventListener("click", () => this._editField("name", nameEl));
    }

    _onMuteClick() {
        const muted = this.muteBtn.textContent === "Mute";
        localStream.getAudioTracks().forEach(track => track.enabled = !muted);
        this.muteBtn.textContent = muted ? "Unmute" : "Mute";
    }

    _editField(field, el) {
        if (el.querySelector("input")) return;
        const currentValue = this[`_${field}`];
        const input = document.createElement("input");
        input.type = "text";
        input.value = currentValue;
        input.maxLength = 64;
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

    _openEmojiPicker(emojiEl) {
        if (document.querySelector(".emoji-picker")) return;
        const picker = document.createElement("div");
        picker.className = "emoji-picker";

        const categories = Object.keys(EMOJI_CATEGORIES);
        const tabs = document.createElement("div");
        tabs.className = "emoji-picker-tabs";
        let activeCategory = categories[0];

        const grid = document.createElement("div");
        grid.className = "emoji-picker-grid";

        const renderGrid = (category) => {
            grid.textContent = "";
            for (const emoji of EMOJI_CATEGORIES[category]) {
                const span = document.createElement("span");
                span.className = "emoji-picker-item";
                span.textContent = emoji;
                span.addEventListener("click", () => {
                    this.emoji = emoji;
                    signalingSocket.send(JSON.stringify({ type: "rename", emoji }));
                    picker.remove();
                });
                grid.appendChild(span);
            }
        }

        for (const cat of categories) {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "emoji-picker-tab";
            tab.textContent = EMOJI_CATEGORIES[cat][0];
            tab.addEventListener("click", () => {
                activeCategory = cat;
                tabs.querySelectorAll(".emoji-picker-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                renderGrid(cat);
            });
            if (cat === activeCategory) tab.classList.add("active");
            tabs.appendChild(tab);
        }

        picker.appendChild(tabs);
        picker.appendChild(grid);
        renderGrid(activeCategory);

        emojiEl.parentElement.appendChild(picker);
        picker.tabIndex = -1;
        picker.focus();

        const onClickOutside = (e) => {
            if (!picker.contains(e.target) && e.target !== emojiEl) {
                picker.remove();
                document.removeEventListener("click", onClickOutside, true);
                document.removeEventListener("keydown", onEscape);
            }
        };
        const onEscape = (e) => {
            if (e.key === "Escape") {
                picker.remove();
                document.removeEventListener("click", onClickOutside, true);
                document.removeEventListener("keydown", onEscape);
            }
        };
        setTimeout(() => document.addEventListener("click", onClickOutside, true), 0);
        document.addEventListener("keydown", onEscape);
    }
}

class Peer extends PeerBase {

    constructor(id, emoji, name) {
        super("peer-template", { id, emoji, name });
        this.audioElement = this.element.querySelector("audio");
        this.volumeSlider = this.element.querySelector(".volume");

        this.volumeSlider.addEventListener("input", () => {
            this.audioElement.volume = this.volumeSlider.value;
        });

        this.pc = new RTCPeerConnection({iceServers: iceServers});
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

    _onMuteClick() {
        this.audioElement.muted = !this.audioElement.muted;
        this.muteBtn.textContent = this.audioElement.muted ? "Unmute" : "Mute";
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
            if (message.iceServers) iceServers = message.iceServers;
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
                if (!document.querySelector(".emoji-picker")) emojiEl.textContent = message.emoji;
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