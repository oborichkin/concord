import { test, expect } from '@playwright/test';

async function waitForConnect(page) {
    await page.waitForEvent('console', msg => msg.text() === 'Connected to signaling server');
}

async function connectUser(browser) {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    const connected = waitForConnect(page);
    await page.goto('/');
    await connected;
    return { context, page };
}

test('page loads correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Concord');
    await expect(page.locator('#peers')).toBeAttached();
    await expect(page.locator('#self-template')).toBeAttached();
    await expect(page.locator('#peer-template')).toBeAttached();
});

test('single user connects to signaling server', async ({ page }) => {
    const connected = waitForConnect(page);
    await page.goto('/');
    await connected;
});

test('self entry renders on connect', async ({ browser }) => {
    const user = await connectUser(browser);

    const self = user.page.locator('#peers article.self');
    await expect(self).toBeAttached();
    await expect(self.locator('.peer-name')).not.toBeEmpty();
    await expect(self.locator('.mute-btn')).toHaveText('Mute');
    await expect(self.locator('audio')).toHaveCount(0);
    await expect(self.locator('.volume')).toHaveCount(0);

    await user.context.close();
});

test('self mute button toggles microphone track', async ({ browser }) => {
    const user = await connectUser(browser);

    const self = user.page.locator('#peers article.self');
    const muteBtn = self.locator('.mute-btn');

    await expect(muteBtn).toHaveText('Mute');
    const enabledBefore = await user.page.evaluate(() =>
        window.localStream.getAudioTracks().every(t => t.enabled)
    );
    expect(enabledBefore).toBe(true);

    await muteBtn.click();
    await expect(muteBtn).toHaveText('Unmute');
    const enabledAfter = await user.page.evaluate(() =>
        window.localStream.getAudioTracks().every(t => t.enabled)
    );
    expect(enabledAfter).toBe(false);

    await muteBtn.click();
    await expect(muteBtn).toHaveText('Mute');
    const enabledRestored = await user.page.evaluate(() =>
        window.localStream.getAudioTracks().every(t => t.enabled)
    );
    expect(enabledRestored).toBe(true);

    await user.context.close();
});

test('self entry appears before peers', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user1.page.locator('#peers article')).toHaveCount(2);

    const firstArticle = user1.page.locator('#peers article').first();
    await expect(firstArticle).toHaveClass(/self/);

    await user1.context.close();
    await user2.context.close();
});

test('two users see each other as peers', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user1.page.locator('#peers article')).toHaveCount(2);
    await expect(user2.page.locator('#peers article')).toHaveCount(2);

    const peer1Name = user1.page.locator('#peers article:not(.self) .peer-name').first();
    const peer2Name = user2.page.locator('#peers article:not(.self) .peer-name').first();
    await expect(peer1Name).not.toBeEmpty();
    await expect(peer2Name).not.toBeEmpty();

    await user1.context.close();
    await user2.context.close();
});

test('user leaving removes peer from remaining user', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user1.page.locator('#peers article')).toHaveCount(2);

    await user2.context.close();

    await expect(user1.page.locator('#peers article')).toHaveCount(1);
    await expect(user1.page.locator('#peers article.self')).toHaveCount(1);

    await user1.context.close();
});

test('mute button toggles text on peer', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    const peer = user1.page.locator('#peers article:not(.self)').first();
    const muteBtn = peer.locator('.mute-btn');

    await expect(muteBtn).toHaveText('Mute');
    await muteBtn.click();
    await expect(muteBtn).toHaveText('Unmute');
    await muteBtn.click();
    await expect(muteBtn).toHaveText('Mute');

    await user1.context.close();
    await user2.context.close();
});

test('audio flows between users via WebRTC', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user1.page.locator('#peers article')).toHaveCount(2);
    await expect(user2.page.locator('#peers article')).toHaveCount(2);

    await user1.page.waitForFunction(
        () => document.querySelector('#peers article:not(.self) audio')?.srcObject !== null,
        { timeout: 15000 },
    );
    await user2.page.waitForFunction(
        () => document.querySelector('#peers article:not(.self) audio')?.srcObject !== null,
        { timeout: 15000 },
    );

    await user1.context.close();
    await user2.context.close();
});

test('volume slider changes audio element volume', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    const peer = user1.page.locator('#peers article:not(.self)').first();
    const slider = peer.locator('.volume');
    const audio = peer.locator('audio');

    await slider.fill('0.5');
    const volume = await audio.evaluate(el => el.volume);
    expect(volume).toBeCloseTo(0.5);

    await slider.fill('0.2');
    const volume2 = await audio.evaluate(el => el.volume);
    expect(volume2).toBeCloseTo(0.2);

    await user1.context.close();
    await user2.context.close();
});
