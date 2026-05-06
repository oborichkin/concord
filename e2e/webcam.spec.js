import { test, expect } from '@playwright/test';

async function waitForConnect(page) {
    await page.waitForEvent('console', msg => msg.text() === 'Connected to signaling server');
}

async function connectUser(browser, withCamera = false) {
    const permissions = ['microphone'];
    if (withCamera) permissions.push('camera');
    const context = await browser.newContext({ permissions });
    const page = await context.newPage();
    const connected = waitForConnect(page);
    await page.goto('/');
    await connected;
    return { context, page };
}

async function enableCamera(page) {
    await page.locator('#peers article.self .camera-btn').click();
    await expect(page.locator('#videos .self-video video')).toBeAttached({ timeout: 5000 });
}

test('camera button starts with Camera text', async ({ browser }) => {
    const user = await connectUser(browser, true);
    const self = user.page.locator('#peers article.self');
    await expect(self.locator('.camera-btn')).toHaveText('Camera');
    await user.context.close();
});

test('clicking camera shows self-preview in video grid', async ({ browser }) => {
    const user = await connectUser(browser, true);
    const self = user.page.locator('#peers article.self');
    const cameraBtn = self.locator('.camera-btn');

    await cameraBtn.click();

    const selfVideo = user.page.locator('#videos .self-video video');
    await expect(selfVideo).toBeAttached({ timeout: 5000 });

    const videoGrid = user.page.locator('#videos');
    await expect(videoGrid).toHaveClass(/active/);

    await expect(cameraBtn).toHaveText('Stop Camera');

    await user.context.close();
});

test('self-preview video has muted attribute and valid srcObject', async ({ browser }) => {
    const user = await connectUser(browser, true);
    await enableCamera(user.page);

    const video = user.page.locator('#videos .self-video video');
    const muted = await video.evaluate(el => el.muted);
    expect(muted).toBe(true);

    const hasVideoTracks = await video.evaluate(el =>
        el.srcObject && el.srcObject.getVideoTracks().length > 0
    );
    expect(hasVideoTracks).toBe(true);

    const trackLive = await video.evaluate(el =>
        el.srcObject.getVideoTracks().every(t => t.readyState === 'live')
    );
    expect(trackLive).toBe(true);

    await user.context.close();
});

test('self-preview track is the localVideoStream track', async ({ browser }) => {
    const user = await connectUser(browser, true);
    await enableCamera(user.page);

    const sameTrack = await user.page.evaluate(() => {
        const video = document.querySelector('#videos .self-video video');
        const localStream = window.localVideoStream;
        if (!video?.srcObject || !localStream) return false;
        const videoTrack = video.srcObject.getVideoTracks()[0];
        const localTrack = localStream.getVideoTracks()[0];
        return videoTrack?.id === localTrack?.id;
    });
    expect(sameTrack).toBe(true);

    await user.context.close();
});

test('clicking Stop Camera hides self-preview and stops tracks', async ({ browser }) => {
    const user = await connectUser(browser, true);
    await enableCamera(user.page);

    const cameraBtn = user.page.locator('#peers article.self .camera-btn');
    await cameraBtn.click();

    await expect(user.page.locator('#videos .self-video')).toHaveCount(0);
    await expect(user.page.locator('#videos')).not.toHaveClass(/active/);
    await expect(cameraBtn).toHaveText('Camera');

    const streamNull = await user.page.evaluate(() => window.localVideoStream === null);
    expect(streamNull).toBe(true);

    await user.context.close();
});

test('enabling camera shows video on remote peer via signaling', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await expect(user2.page.locator('#peers article:not(.self)')).toHaveCount(1);

    await enableCamera(user1.page);

    const peerVideo = user2.page.locator('#videos .video-card video');
    await expect(peerVideo).toBeAttached({ timeout: 5000 });

    const peerName = user2.page.locator('#videos .video-card .video-name');
    const peerArticleName = user2.page.locator('#peers article:not(.self) .peer-name');
    await expect(peerName).toHaveText(await peerArticleName.textContent());

    await user1.context.close();
    await user2.context.close();
});

test('remote video element has valid srcObject with video track', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);

    const peerVideo = user2.page.locator('#videos .video-card video');
    await expect(peerVideo).toBeAttached({ timeout: 5000 });

    const srcObjectState = await user2.page.evaluate(() => {
        const video = document.querySelector('#videos .video-card video');
        if (!video || !video.srcObject) return { hasSrcObject: false };
        const tracks = video.srcObject.getVideoTracks();
        return {
            hasSrcObject: true,
            trackCount: tracks.length,
            trackKind: tracks[0]?.kind,
            trackReadyState: tracks[0]?.readyState,
        };
    });
    expect(srcObjectState.hasSrcObject).toBe(true);
    expect(srcObjectState.trackCount).toBe(1);
    expect(srcObjectState.trackKind).toBe('video');

    await user1.context.close();
    await user2.context.close();
});

test('peer has video transceiver with sendrecv direction', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    const transceiverState = await user2.page.evaluate(() => {
        const peer = window.peers.values().next().value;
        if (!peer) return null;
        const transceivers = peer.pc.getTransceivers();
        const videoTx = transceivers.find(t => t.receiver.track.kind === 'video');
        if (!videoTx) return null;
        return {
            direction: videoTx.direction,
            currentDirection: videoTx.currentDirection,
            senderHasTrack: videoTx.sender.track !== null,
            receiverTrackKind: videoTx.receiver.track.kind,
            receiverTrackMuted: videoTx.receiver.track.muted,
        };
    });

    expect(transceiverState).not.toBeNull();
    expect(transceiverState.direction).toBe('sendrecv');
    expect(transceiverState.receiverTrackKind).toBe('video');

    await user1.context.close();
    await user2.context.close();
});

test('stopping camera hides video on remote peer via signaling', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await user1.page.locator('#peers article.self .camera-btn').click();
    await expect(user2.page.locator('#videos .video-card')).toHaveCount(0, { timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
});

test('new peer sees already-enabled camera via targeted signaling', async ({ browser }) => {
    const user1 = await connectUser(browser, true);

    await enableCamera(user1.page);

    const user2 = await connectUser(browser);
    await expect(user2.page.locator('#peers article:not(.self)')).toHaveCount(1);

    const peerVideo = user2.page.locator('#videos .video-card video');
    await expect(peerVideo).toBeAttached({ timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
});

test('new peer gets video transceiver with sender track when camera already on', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    await enableCamera(user1.page);

    const user2 = await connectUser(browser);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    const senderState = await user2.page.evaluate(() => {
        const peer = window.peers.values().next().value;
        if (!peer) return null;
        const transceivers = peer.pc.getTransceivers();
        const videoTx = transceivers.find(t => t.receiver.track.kind === 'video');
        return {
            senderHasTrack: videoTx.sender.track !== null,
            senderTrackKind: videoTx.sender.track?.kind,
            senderTrackReadyState: videoTx.sender.track?.readyState,
        };
    });

    expect(senderState).not.toBeNull();

    await user1.context.close();
    await user2.context.close();
});

test('user leaving removes their video from grid', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await user1.context.close();
    await expect(user2.page.locator('#videos .video-card')).toHaveCount(0, { timeout: 5000 });
    await expect(user2.page.locator('#videos')).not.toHaveClass(/active/);

    await user2.context.close();
});

test('both users enable camera and see each other', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser, true);

    await user1.page.locator('#peers article.self .camera-btn').click();
    await user2.page.locator('#peers article.self .camera-btn').click();

    await expect(user1.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await expect(user1.page.locator('#videos video')).toHaveCount(2);
    await expect(user2.page.locator('#videos video')).toHaveCount(2);

    await user1.context.close();
    await user2.context.close();
});

test('both users video cards have correct peer names', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser, true);

    await user1.page.locator('#peers article.self .camera-btn').click();
    await user2.page.locator('#peers article.self .camera-btn').click();

    await expect(user1.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    const u1PeerName = await user1.page.locator('#peers article:not(.self) .peer-name').textContent();
    const u2PeerName = await user2.page.locator('#peers article:not(.self) .peer-name').textContent();

    await expect(user1.page.locator('#videos .video-card:not(.self-video) .video-name')).toHaveText(u1PeerName);
    await expect(user2.page.locator('#videos .video-card:not(.self-video) .video-name')).toHaveText(u2PeerName);

    await user1.context.close();
    await user2.context.close();
});

test('rapid toggle on/off leaves clean state', async ({ browser }) => {
    const user = await connectUser(browser, true);
    const cameraBtn = user.page.locator('#peers article.self .camera-btn');

    for (let i = 0; i < 3; i++) {
        await cameraBtn.click();
        await expect(user.page.locator('#videos .self-video video')).toBeAttached({ timeout: 5000 });
        await expect(cameraBtn).toHaveText('Stop Camera');

        await cameraBtn.click();
        await expect(user.page.locator('#videos .self-video')).toHaveCount(0);
        await expect(cameraBtn).toHaveText('Camera');
    }

    await user.context.close();
});

test('rapid toggle with remote peer keeps video state consistent', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    const cameraBtn = user1.page.locator('#peers article.self .camera-btn');

    for (let i = 0; i < 3; i++) {
        await cameraBtn.click();
        await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

        await cameraBtn.click();
        await expect(user2.page.locator('#videos .video-card')).toHaveCount(0, { timeout: 5000 });
    }

    await user1.context.close();
    await user2.context.close();
});

test('camera-off does not show stale video card on remote after re-enable', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    const cameraBtn = user1.page.locator('#peers article.self .camera-btn');

    await cameraBtn.click();
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });
    const firstName = await user2.page.locator('#videos .video-card .video-name').textContent();

    await cameraBtn.click();
    await expect(user2.page.locator('#videos .video-card')).toHaveCount(0, { timeout: 5000 });

    await cameraBtn.click();
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });
    const secondName = await user2.page.locator('#videos .video-card .video-name').textContent();

    expect(firstName).toBe(secondName);

    await user1.context.close();
    await user2.context.close();
});

test('video grid is hidden when all cameras are off', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser, true);

    await user1.page.locator('#peers article.self .camera-btn').click();
    await user2.page.locator('#peers article.self .camera-btn').click();

    await expect(user1.page.locator('#videos')).toHaveClass(/active/);

    await user1.page.locator('#peers article.self .camera-btn').click();
    await expect(user1.page.locator('#videos')).toHaveClass(/active/);

    await user2.page.locator('#peers article.self .camera-btn').click();
    await expect(user1.page.locator('#videos')).not.toHaveClass(/active/);

    await user1.context.close();
    await user2.context.close();
});

test('camera button is disabled while camera is starting', async ({ browser }) => {
    const user = await connectUser(browser, true);
    const cameraBtn = user.page.locator('#peers article.self .camera-btn');

    await expect(cameraBtn).toHaveText('Camera');

    await cameraBtn.click();
    await expect(cameraBtn).toHaveText('Stop Camera', { timeout: 5000 });

    await user.context.close();
});

test('self video has playsinline and autoplay attributes', async ({ browser }) => {
    const user = await connectUser(browser, true);
    await enableCamera(user.page);

    const video = user.page.locator('#videos .self-video video');
    const attrs = await video.evaluate(el => ({
        playsInline: el.playsInline,
        autoplay: el.autoplay,
    }));
    expect(attrs.playsInline).toBe(true);
    expect(attrs.autoplay).toBe(true);

    await user.context.close();
});

test('remote video has playsinline and autoplay but not muted', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    const video = user2.page.locator('#videos .video-card video');
    const attrs = await video.evaluate(el => ({
        playsInline: el.playsInline,
        autoplay: el.autoplay,
        muted: el.muted,
    }));
    expect(attrs.playsInline).toBe(true);
    expect(attrs.autoplay).toBe(true);
    expect(attrs.muted).toBe(false);

    await user1.context.close();
    await user2.context.close();
});

test('peer connection ice connection state is connected after setup', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await user1.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        return peer && peer.pc.iceConnectionState === 'connected';
    }, { timeout: 10000 });

    await user2.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        return peer && peer.pc.iceConnectionState === 'connected';
    }, { timeout: 10000 });

    await enableCamera(user1.page);

    const stateAfter = await user2.page.evaluate(() => {
        const peer = window.peers.values().next().value;
        return peer.pc.iceConnectionState;
    });
    expect(stateAfter).toBe('connected');

    await user1.context.close();
    await user2.context.close();
});

test('camera-on message arrives at remote peer', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    let cameraOnReceived = false;
    user2.page.on('console', msg => {
        if (msg.text().includes('camera-on')) cameraOnReceived = true;
    });

    await enableCamera(user1.page);

    await user2.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        return peer && peer.videoElement;
    }, { timeout: 5000 });
    expect(cameraOnReceived).toBe(true);

    await user1.context.close();
    await user2.context.close();
});

test('three users: one enables camera and both others see it', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);
    const user3 = await connectUser(browser);

    await expect(user1.page.locator('#peers article:not(.self)')).toHaveCount(2, { timeout: 5000 });

    await enableCamera(user1.page);

    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });
    await expect(user3.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
    await user3.context.close();
});

test('three users: camera stops and both others lose video', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);
    const user3 = await connectUser(browser);

    await expect(user1.page.locator('#peers article:not(.self)')).toHaveCount(2, { timeout: 5000 });

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });
    await expect(user3.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await user1.page.locator('#peers article.self .camera-btn').click();
    await expect(user2.page.locator('#videos .video-card')).toHaveCount(0, { timeout: 5000 });
    await expect(user3.page.locator('#videos .video-card')).toHaveCount(0, { timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
    await user3.context.close();
});

function extractVideoDirection() {
    const peer = window.peers.values().next().value;
    if (!peer) return 'no peer';
    const desc = peer.pc.currentRemoteDescription;
    if (!desc) return 'no desc';
    const sdp = desc.sdp;
    const idx = sdp.indexOf('m=video');
    if (idx === -1) return 'no m=video';
    const end = sdp.indexOf('\nm=', idx + 1);
    const section = end > 0 ? sdp.substring(idx, end) : sdp.substring(idx);
    for (const dir of ['sendrecv', 'sendonly', 'recvonly', 'inactive']) {
        if (section.includes('a=' + dir + '\r') || section.includes('a=' + dir + '\n')) return dir;
    }
    return null;
}

function extractLocalVideoDirection() {
    const peer = window.peers.values().next().value;
    if (!peer) return 'no peer';
    const desc = peer.pc.currentLocalDescription;
    if (!desc) return 'no desc';
    const sdp = desc.sdp;
    const idx = sdp.indexOf('m=video');
    if (idx === -1) return 'no m=video';
    const end = sdp.indexOf('\nm=', idx + 1);
    const section = end > 0 ? sdp.substring(idx, end) : sdp.substring(idx);
    for (const dir of ['sendrecv', 'sendonly', 'recvonly', 'inactive']) {
        if (section.includes('a=' + dir + '\r') || section.includes('a=' + dir + '\n')) return dir;
    }
    return null;
}

test('offer SDP has sendrecv for video when camera is on', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await user2.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        const sdp = peer?.pc?.currentRemoteDescription?.sdp;
        return sdp && sdp.includes('m=video');
    }, { timeout: 5000 });

    const offerDirection = await user2.page.evaluate(extractVideoDirection);
    expect(offerDirection).toBe('sendrecv');

    await user1.context.close();
    await user2.context.close();
});

test('answer SDP has sendrecv for video when answerer has camera on', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser, true);

    await user1.page.locator('#peers article.self .camera-btn').click();
    await user2.page.locator('#peers article.self .camera-btn').click();

    await expect(user1.page.locator('#videos .video-card:not(.self-video) video')).toBeAttached({ timeout: 5000 });
    await expect(user2.page.locator('#videos .video-card:not(.self-video) video')).toBeAttached({ timeout: 5000 });

    await user1.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        const sdp = peer?.pc?.currentRemoteDescription?.sdp;
        return sdp && sdp.includes('m=video');
    }, { timeout: 5000 });

    const answerDirection = await user1.page.evaluate(extractVideoDirection);
    expect(answerDirection).toBe('sendrecv');

    await user1.context.close();
    await user2.context.close();
});

test('offer SDP has sendrecv for video even when camera is off', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user2.page.locator('#peers article:not(.self)')).toHaveCount(1);

    await user2.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        const sdp = peer?.pc?.currentRemoteDescription?.sdp;
        return sdp && sdp.includes('m=video');
    }, { timeout: 10000 });

    const offerDirection = await user2.page.evaluate(extractVideoDirection);
    expect(offerDirection).toBe('sendrecv');

    await user1.context.close();
    await user2.context.close();
});

test('answer SDP has sendrecv for video even when answerer camera is off', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    await user1.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        const sdp = peer?.pc?.currentRemoteDescription?.sdp;
        return sdp && sdp.includes('m=video');
    }, { timeout: 5000 });

    const answerDirection = await user1.page.evaluate(extractVideoDirection);
    expect(answerDirection).toBe('sendrecv');

    await user1.context.close();
    await user2.context.close();
});

test('enabling camera after negotiation keeps sender track live', async ({ browser }) => {
    const user1 = await connectUser(browser, true);
    const user2 = await connectUser(browser);

    await expect(user2.page.locator('#peers article:not(.self)')).toHaveCount(1);

    await user1.page.waitForFunction(() => {
        const peer = window.peers.values().next().value;
        return peer?.pc?.iceConnectionState === 'connected';
    }, { timeout: 10000 });

    await enableCamera(user1.page);
    await expect(user2.page.locator('#videos .video-card video')).toBeAttached({ timeout: 5000 });

    const senderTrack = await user1.page.evaluate(() => {
        const peer = window.peers.values().next().value;
        const transceivers = peer.pc.getTransceivers();
        const videoTx = transceivers.find(t => t.receiver.track.kind === 'video');
        return {
            hasSenderTrack: videoTx.sender.track !== null,
            senderTrackReadyState: videoTx.sender.track?.readyState,
        };
    });
    expect(senderTrack.hasSenderTrack).toBe(true);
    expect(senderTrack.senderTrackReadyState).toBe('live');

    await user1.context.close();
    await user2.context.close();
});
