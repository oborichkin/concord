const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
];
let iceServers = ICE_SERVERS;
const CONNECTION_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/`;

let localStream = null;
let signalingSocket = null;

let peers = new Map();
let selfUser = null;
const peersDiv = document.getElementById('peers');

class PeerBase {
    constructor(templateId, { id, emoji, name, prepend } = {}) {
        this.id = id;

        const node = document.getElementById(templateId).content.cloneNode(true);
        this.root = node.querySelector("article");

        this._name = name;
        this.nameEl = this.root.querySelector(".peer-name");
        this.nameEl.textContent = name;

        this._emoji = emoji;
        this.emojiEl = this.root.querySelector(".peer-emoji");
        this.emojiEl.textContent = emoji;

        this._muted = false;
        this.muteBtn = this.root.querySelector(".mute-btn");
        this.muteBtn.addEventListener("click", () => this._onMuteClick());

        peersDiv[prepend ? "prepend" : "append"](this.root);
    }

    _onMuteClick() {
        this._muted = !this._muted;
        this.muteBtn.textContent = this._muted ? "Unmute" : "Mute";
        this._setMuted(this._muted);
    }

    set name(value) {
        this._name = value;
        this.nameEl.textContent = value;
    }

    get name() {
        return this._name;
    }

    set emoji(value) {
        this._emoji = value;
        this.emojiEl.textContent = value;
    }

    get emoji() {
        return this._emoji;
    }
}

class Self extends PeerBase {
    constructor(id, emoji, name) {
        super("self-template", { id, emoji, name, prepend: true });
        this.emojiEl.addEventListener("click", () => this._openEmojiPicker());
        this.nameEl.addEventListener("click", () => this._editName());
    }

    set name(value) {
        signalingSocket.send(JSON.stringify({ type: "user-renamed", name: value }));
        super.name = value;
    }

    get name() {
        return super.name;
    }

    set emoji(value) {
        super.emoji = value;
        signalingSocket.send(JSON.stringify({ type: "user-renamed", emoji: value }));
    }

    get emoji() {
        return super.emoji;
    }

    _setMuted(muted) {
        localStream.getAudioTracks().forEach(track => track.enabled = !muted);
    }

    _editName() {
        if (this.nameEl.querySelector("input")) return;
    
        const currentValue = this.name;
        const input = document.createElement("input");

        input.type = "text";
        input.value = currentValue;
        input.maxLength = 64;

        this.nameEl.textContent = "";
        this.nameEl.appendChild(input);

        input.focus();
        input.select();

        const commit = () => {
            const value = input.value.trim();
            if (value && value !== currentValue) this.name = value;
            else this.nameEl.textContent = currentValue;
            input.remove();
        };

        input.addEventListener("blur", commit, { once: true });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
            if (e.key === "Escape") { input.value = currentValue; input.blur(); }
        });
    }

    _openEmojiPicker() {
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
                    picker.remove();
                });
                grid.appendChild(span);
            }
        };

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

        this.emojiEl.parentElement.appendChild(picker);
        picker.tabIndex = -1;
        picker.focus();

        const onClickOutside = (e) => {
            if (!picker.contains(e.target) && e.target !== this.emojiEl) {
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
        this.audioElement = this.root.querySelector("audio");
        this.volumeSlider = this.root.querySelector(".volume");

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
                }));
            }
        };

        this.pc.ontrack = (event) => {
            this.audioElement.srcObject = event.streams[0] || new MediaStream([event.track]);
            this.audioElement.play().catch(console.error);
        };
    }

    _setMuted(muted) {
        this.audioElement.muted = muted;
    }

    destroy() {
        this.pc.close();
        this.root.remove();
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
            const renamedPeer = peers.get(message.user);
            if (renamedPeer) {
                renamedPeer.name = message.name ?? renamedPeer.name;
                renamedPeer.emoji = message.emoji ?? renamedPeer.emoji;
            }
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

        signalingSocket = new WebSocket(CONNECTION_URL);
        signalingSocket.onopen = () => {};
        signalingSocket.onerror = (error) => {
            console.error('Signaling error:', error);
        };
        signalingSocket.onclose = () => {};
        signalingSocket.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            await handleMessage(message);
        };
    } catch (error) {
        console.error(error);
    }
}

connect();

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