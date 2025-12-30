class VoiceChat {
    constructor() {
        // WebRTC configuration
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Connection state
        this.localStream = null;
        this.peerConnections = {};
        this.signalingSocket = null;
        this.roomId = null;
        this.userId = this.generateUserId();

        // DOM Elements
        this.startBtn = document.getElementById('startBtn');
        this.hangupBtn = document.getElementById('hangupBtn');
        this.joinBtn = document.getElementById('joinBtn');
        this.roomInput = document.getElementById('roomInput');
        this.statusEl = document.getElementById('status');
        this.roomStatusEl = document.getElementById('roomStatus');
        this.localAudio = document.getElementById('localAudio');
        this.remoteAudios = document.getElementById('remoteAudios');
        this.peerCountEl = document.getElementById('peerCount');

        // Event listeners
        this.startBtn.addEventListener('click', () => this.startChat());
        this.hangupBtn.addEventListener('click', () => this.hangUp());
        this.joinBtn.addEventListener('click', () => this.joinRoom());

        // Connect to signaling server
        this.connectSignaling();
    }

    generateUserId() {
        return Math.random().toString(36).substr(2, 9);
    }

    connectSignaling() {
        // Use WebSocket for signaling (adjust URL as needed)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsPath = '/ws/';
        const wsUrl = `${protocol}//${window.location.host}${wsPath}`;

        this.signalingSocket = new WebSocket(wsUrl);

        this.signalingSocket.onopen = () => {
            console.log('Connected to signaling server');
            this.updateStatus('Connected to server');
        };

        this.signalingSocket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleSignalingMessage(message);
        };

        this.signalingSocket.onerror = (error) => {
            console.error('Signaling error:', error);
            this.updateStatus('Connection error');
        };

        this.signalingSocket.onclose = () => {
            console.log('Signaling connection closed');
            this.updateStatus('Disconnected from server');
        };
    }

    async startChat() {
        try {
            // Get microphone access
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            // Play local audio (muted to avoid echo)
            this.localAudio.srcObject = this.localStream;

            // Update UI
            this.startBtn.disabled = true;
            this.hangupBtn.disabled = false;
            this.updateStatus('Microphone active');

            // If we're in a room, send our stream to existing peers
            if (this.roomId) {
                this.sendToRoom({ type: 'user-joined', userId: this.userId });
            }

        } catch (error) {
            console.error('Error accessing microphone:', error);
            this.updateStatus('Microphone access denied');
            alert('Please allow microphone access to use voice chat');
        }
    }

    async joinRoom() {
        const roomId = this.roomInput.value.trim();
        if (!roomId) {
            alert('Please enter a room name');
            return;
        }

        this.roomId = roomId;
        this.updateStatus(`Joining room: ${roomId}`);
        this.roomStatusEl.textContent = `Room: ${roomId}`;

        // Join the room
        this.sendToServer({
            type: 'join-room',
            roomId: roomId,
            userId: this.userId
        });
    }

    sendToServer(message) {
        if (this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(JSON.stringify(message));
        }
    }

    sendToRoom(message) {
        Object.values(this.peerConnections).forEach(peer => {
            if (peer.dataChannel?.readyState === 'open') {
                peer.dataChannel.send(JSON.stringify(message));
            }
        });
    }

    handleSignalingMessage(message) {
        switch (message.type) {
            case 'room-joined':
                this.handleRoomJoined(message);
                break;
            case 'user-joined':
                this.handleUserJoined(message);
                break;
            case 'user-left':
                this.handleUserLeft(message);
                break;
            case 'offer':
                this.handleOffer(message);
                break;
            case 'answer':
                this.handleAnswer(message);
                break;
            case 'ice-candidate':
                this.handleIceCandidate(message);
                break;
            case 'room-users':
                this.handleRoomUsers(message);
                break;
        }
    }

    handleRoomJoined(message) {
        this.updateStatus(`Joined room: ${message.roomId}`);
        
        // Connect to existing users
        message.users.forEach(userId => {
            if (userId !== this.userId) {
                this.createPeerConnection(userId);
            }
        });

        this.updatePeerCount();
    }

    handleUserJoined(message) {
        const { userId } = message;
        if (userId !== this.userId && !this.peerConnections[userId]) {
            this.createPeerConnection(userId);
            this.updatePeerCount();
        }
    }

    handleUserLeft(message) {
        const { userId } = message;
        this.closePeerConnection(userId);
        this.updatePeerCount();
    }

    async createPeerConnection(remoteUserId) {
        console.log(`Creating peer connection with ${remoteUserId}`);

        const peerConnection = new RTCPeerConnection(this.configuration);
        this.peerConnections[remoteUserId] = peerConnection;

        // Add local stream if available
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Create data channel for signaling
        const dataChannel = peerConnection.createDataChannel('signaling');
        peerConnection.dataChannel = dataChannel;

        dataChannel.onopen = () => {
            console.log(`Data channel opened with ${remoteUserId}`);
        };

        dataChannel.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'user-joined') {
                // Send our offer if we haven't already
                this.createOffer(remoteUserId);
            }
        };

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            this.addRemoteAudio(remoteUserId, event.streams[0]);
        };

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendToServer({
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    targetUserId: remoteUserId,
                    userId: this.userId
                });
            }
        };

        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${remoteUserId}: ${peerConnection.connectionState}`);
        };

        // If we're initiating the connection, create an offer
        setTimeout(() => {
            if (dataChannel.readyState === 'open') {
                this.createOffer(remoteUserId);
            }
        }, 1000);
    }

    async createOffer(remoteUserId) {
        const peerConnection = this.peerConnections[remoteUserId];
        if (!peerConnection) return;

        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            this.sendToServer({
                type: 'offer',
                offer: offer,
                targetUserId: remoteUserId,
                userId: this.userId
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(message) {
        const { userId: remoteUserId, offer } = message;
        
        let peerConnection = this.peerConnections[remoteUserId];
        if (!peerConnection) {
            peerConnection = await this.createPeerConnection(remoteUserId);
        }

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            this.sendToServer({
                type: 'answer',
                answer: answer,
                targetUserId: remoteUserId,
                userId: this.userId
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(message) {
        const { userId: remoteUserId, answer } = message;
        const peerConnection = this.peerConnections[remoteUserId];
        
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error('Error handling answer:', error);
            }
        }
    }

    async handleIceCandidate(message) {
        const { userId: remoteUserId, candidate } = message;
        const peerConnection = this.peerConnections[remoteUserId];
        
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('Error adding ICE candidate:', error);
            }
        }
    }

    handleRoomUsers(message) {
        message.users.forEach(userId => {
            if (userId !== this.userId && !this.peerConnections[userId]) {
                this.createPeerConnection(userId);
            }
        });
        this.updatePeerCount();
    }

    addRemoteAudio(userId, stream) {
        // Remove existing audio element if present
        const existingAudio = document.getElementById(`audio-${userId}`);
        if (existingAudio) {
            existingAudio.remove();
        }

        // Create new audio element
        const audio = document.createElement('audio');
        audio.id = `audio-${userId}`;
        audio.autoplay = true;
        audio.srcObject = stream;
        audio.controls = false;

        const container = document.createElement('div');
        container.className = 'remote-audio';
        container.innerHTML = `<small>User: ${userId.substring(0, 8)}</small>`;
        container.appendChild(audio);

        this.remoteAudios.appendChild(container);
    }

    closePeerConnection(userId) {
        const peerConnection = this.peerConnections[userId];
        if (peerConnection) {
            peerConnection.close();
            delete this.peerConnections[userId];
        }

        // Remove audio element
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) {
            audioElement.parentElement.remove();
        }

        console.log(`Closed connection with ${userId}`);
    }

    hangUp() {
        // Close all peer connections
        Object.keys(this.peerConnections).forEach(userId => {
            this.closePeerConnection(userId);
        });

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            this.localAudio.srcObject = null;
        }

        // Leave room
        if (this.roomId) {
            this.sendToServer({
                type: 'leave-room',
                roomId: this.roomId,
                userId: this.userId
            });
            this.roomId = null;
            this.roomStatusEl.textContent = 'Not in a room';
        }

        // Update UI
        this.startBtn.disabled = false;
        this.hangupBtn.disabled = true;
        this.updateStatus('Call ended');
        this.updatePeerCount();

        // Clear remote audios
        this.remoteAudios.innerHTML = '';
    }

    updateStatus(text) {
        this.statusEl.textContent = text;
        console.log(`Status: ${text}`);
    }

    updatePeerCount() {
        const count = Object.keys(this.peerConnections).length;
        this.peerCountEl.textContent = count;
    }
}

// Initialize the app when page loads
window.addEventListener('load', () => {
    new VoiceChat();
});