const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
];
let iceServers = ICE_SERVERS;
const CONNECTION_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/`;

let localStream = null;
let localVideoStream = null;
let signalingSocket = null;

let peers = new Map();
window.peers = peers;
let selfUser = null;
let peersDiv = document.getElementById('peers');
let videosDiv = document.getElementById('videos');

function updateVideoGrid() {
    const hasVideos = videosDiv.querySelector('video');
    videosDiv.classList.toggle('active', !!hasVideos);
}

class PeerBase {
    constructor(templateId) {
        const node = document.getElementById(templateId).content.cloneNode(true);
        this.element = node.querySelector("article");
        this.videoCard = null;
        this.videoElement = null;
    }

    set name(value) {
        this._name = value;
        this.element.querySelector(".peer-name").textContent = value;
        if (this.videoCard) this.videoCard.querySelector(".video-name").textContent = value;
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

    _showVideo(stream, options = {}) {
        if (!this.videoCard) {
            this.videoCard = document.createElement("div");
            this.videoCard.className = "video-card" + (options.self ? " self-video" : "");
            const video = document.createElement("video");
            video.playsInline = true;
            video.autoplay = true;
            if (options.muted) video.muted = true;
            this.videoCard.appendChild(video);
            const caption = document.createElement("span");
            caption.className = "video-name";
            caption.textContent = this.name;
            this.videoCard.appendChild(caption);
            videosDiv.appendChild(this.videoCard);
            this.videoElement = video;
        }
        this.videoElement.srcObject = stream;
        this.videoElement.play().catch(() => {});
        updateVideoGrid();
    }

    _hideVideo() {
        if (this._remoteVideoTrack) {
            this._remoteVideoTrack.onunmute = null;
            this._remoteVideoTrack = null;
        }
        if (this.videoCard) {
            this.videoCard.remove();
            this.videoCard = null;
            this.videoElement = null;
        }
        updateVideoGrid();
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

        const cameraBtn = this.element.querySelector(".camera-btn");
        this._cameraStarting = false;
        cameraBtn.addEventListener("click", () => {
            if (this._cameraStarting) return;
            if (localVideoStream) {
                this._stopCamera();
            } else {
                this._startCamera();
            }
        });

        const emojiEl = this.element.querySelector(".peer-emoji");
        const nameEl = this.element.querySelector(".peer-name");
        emojiEl.addEventListener("click", () => this._openEmojiPicker(emojiEl));
        nameEl.addEventListener("click", () => this._editField("name", nameEl));
    }

    set name(value) {
        const nameEl = this.element.querySelector(".peer-name");
        const input = nameEl.querySelector("input");
        if (input) input.remove();
        super.name = value;
    }

    set emoji(value) {
        if (!document.querySelector(".emoji-picker")) {
            super.emoji = value;
        } else {
            this._emoji = value;
        }
    }

    async _startCamera() {
        if (this._cameraStarting) return;
        this._cameraStarting = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            localVideoStream = stream;
            window.localVideoStream = stream;
            this._showVideo(stream, { self: true, muted: true });
            const track = stream.getVideoTracks()[0];
            for (const peer of peers.values()) {
                await peer.videoSender.replaceTrack(track);
            }
            this.element.querySelector(".camera-btn").textContent = "Stop Camera";
            for (const peer of peers.values()) {
                signalingSocket.send(JSON.stringify({ type: "camera-on", target: peer.id }));
            }
        } catch (error) {
            console.error('Failed to start camera:', error);
        } finally {
            this._cameraStarting = false;
        }
    }

    async _stopCamera() {
        if (!localVideoStream) return;
        for (const peer of peers.values()) {
            try {
                await peer.videoSender.replaceTrack(null);
            } catch (e) {}
        }
        localVideoStream.getTracks().forEach(t => t.stop());
        localVideoStream = null;
        window.localVideoStream = null;
        this._hideVideo();
        this.element.querySelector(".camera-btn").textContent = "Camera";
        signalingSocket.send(JSON.stringify({ type: "camera-off", user: selfUser.id }));
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
        this.pc = new RTCPeerConnection({iceServers: iceServers});
        localStream.getAudioTracks().forEach(track => this.pc.addTrack(track));
        const videoTransceiver = this.pc.addTransceiver('video', { direction: 'sendrecv' });
        this.videoSender = videoTransceiver.sender;
        this._videoTransceiver = videoTransceiver;
        if (localVideoStream) {
            this.videoSender.replaceTrack(localVideoStream.getVideoTracks()[0]).catch(() => {});
        }

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
            if (event.track.kind === 'audio') {
                this.audioElement.srcObject = event.streams[0] || new MediaStream([event.track]);
                this.audioElement.play().catch(() => {});
            }
        }
    }

    destroy() {
        this.pc.close();
        this._hideVideo();
        this.element.remove();
    }

    showRemoteVideo() {
        const track = this._videoTransceiver.receiver.track;
        this._remoteVideoTrack = track;
        if (track.muted) {
            this._showVideo(new MediaStream([track]));
            track.onunmute = () => {
                if (this.videoElement) {
                    this.videoElement.srcObject = new MediaStream([track]);
                    this.videoElement.play().catch(() => {});
                }
                track.onunmute = null;
            };
        } else {
            this._showVideo(new MediaStream([track]));
        }
    }

    async createAndSendOffer() {
        this._videoTransceiver.direction = 'sendrecv';
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        offer.target = this.id;
        signalingSocket.send(JSON.stringify(offer));
    }

    async handleOffer(offer) {
        await this.pc.setRemoteDescription(offer);
        this._videoTransceiver.direction = 'sendrecv';
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        answer.target = this.id;
        signalingSocket.send(JSON.stringify(answer));
    }

    async addIceCandidate(candidate) {
        await this.pc.addIceCandidate(candidate);
    }

    async handleAnswer(answer) {
        if (this.pc.signalingState !== 'have-local-offer') return;
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
            if (localVideoStream) {
                signalingSocket.send(JSON.stringify({ type: "camera-on", target: message.user }));
            }
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
        case "camera-on":
            peers.get(message.user)?.showRemoteVideo();
            break;
        case "camera-off":
            peers.get(message.user)?._hideVideo();
            break;
        case "user-renamed":
            if (selfUser && message.user === selfUser.id) {
                selfUser.name = message.name;
                selfUser.emoji = message.emoji;
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
