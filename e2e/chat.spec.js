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
    await expect(page.locator('#peer-template')).toBeAttached();
});

test('single user connects to signaling server', async ({ page }) => {
    const connected = waitForConnect(page);
    await page.goto('/');
    await connected;
});

test('two users see each other as peers', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user1.page.locator('#peers article')).toHaveCount(1);
    await expect(user2.page.locator('#peers article')).toHaveCount(1);

    const peer1Name = user1.page.locator('#peers article .peer-name').first();
    const peer2Name = user2.page.locator('#peers article .peer-name').first();
    await expect(peer1Name).not.toBeEmpty();
    await expect(peer2Name).not.toBeEmpty();

    await user1.context.close();
    await user2.context.close();
});

test('user leaving removes peer from remaining user', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await expect(user1.page.locator('#peers article')).toHaveCount(1);

    await user2.context.close();

    await expect(user1.page.locator('#peers article')).toHaveCount(0);

    await user1.context.close();
});

test('mute button toggles text', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    const muteBtn = user1.page.locator('#peers article .mute-btn').first();

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

    await expect(user1.page.locator('#peers article')).toHaveCount(1);
    await expect(user2.page.locator('#peers article')).toHaveCount(1);

    await user1.page.waitForFunction(
        () => document.querySelector('#peers article audio')?.srcObject !== null,
        { timeout: 15000 },
    );
    await user2.page.waitForFunction(
        () => document.querySelector('#peers article audio')?.srcObject !== null,
        { timeout: 15000 },
    );

    await user1.context.close();
    await user2.context.close();
});

test('volume slider changes audio element volume', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    const peer = user1.page.locator('#peers article').first();
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
