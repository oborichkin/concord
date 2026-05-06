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

test('clicking self emoji opens emoji picker', async ({ browser }) => {
    const user = await connectUser(browser);

    const emojiEl = user.page.locator('#peers article.self .peer-emoji');
    await emojiEl.click();
    await expect(user.page.locator('.emoji-picker')).toBeVisible();

    await user.context.close();
});

test('selecting emoji from picker updates self entry', async ({ browser }) => {
    const user = await connectUser(browser);

    const emojiEl = user.page.locator('#peers article.self .peer-emoji');
    await emojiEl.click();

    const pickerItem = user.page.locator('.emoji-picker-grid .emoji-picker-item').first();
    const newEmoji = await pickerItem.textContent();
    await pickerItem.click();

    await expect(user.page.locator('.emoji-picker')).toHaveCount(0);
    await expect(emojiEl).toHaveText(newEmoji);

    await user.context.close();
});

test('emoji change propagates to other user', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await user1.page.locator('#peers article.self .peer-emoji').click();
    const pickerItem = user1.page.locator('.emoji-picker-grid .emoji-picker-item').first();
    const newEmoji = await pickerItem.textContent();
    await pickerItem.click();

    const peerEmoji = user2.page.locator('#peers article:not(.self) .peer-emoji').first();
    await expect(peerEmoji).toHaveText(newEmoji, { timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
});

test('clicking outside picker closes it without changing emoji', async ({ browser }) => {
    const user = await connectUser(browser);

    const emojiEl = user.page.locator('#peers article.self .peer-emoji');
    const originalEmoji = await emojiEl.textContent();

    await emojiEl.click();
    await expect(user.page.locator('.emoji-picker')).toBeVisible();

    await user.page.locator('h1').click();
    await expect(user.page.locator('.emoji-picker')).toHaveCount(0);
    await expect(emojiEl).toHaveText(originalEmoji);

    await user.context.close();
});

test('escape closes picker without changing emoji', async ({ browser }) => {
    const user = await connectUser(browser);

    const emojiEl = user.page.locator('#peers article.self .peer-emoji');
    const originalEmoji = await emojiEl.textContent();

    await emojiEl.click();
    await expect(user.page.locator('.emoji-picker')).toBeVisible();

    await user.page.keyboard.press('Escape');
    await expect(user.page.locator('.emoji-picker')).toHaveCount(0);
    await expect(emojiEl).toHaveText(originalEmoji);

    await user.context.close();
});

test('category tabs switch emoji grid', async ({ browser }) => {
    const user = await connectUser(browser);

    await user.page.locator('#peers article.self .peer-emoji').click();

    const firstTab = user.page.locator('.emoji-picker-tab').first();
    const lastTab = user.page.locator('.emoji-picker-tab').last();
    const firstEmojiBefore = await user.page.locator('.emoji-picker-grid .emoji-picker-item').first().textContent();

    await lastTab.click();
    const firstEmojiAfter = await user.page.locator('.emoji-picker-grid .emoji-picker-item').first().textContent();

    expect(firstEmojiBefore).not.toBe(firstEmojiAfter);

    await user.context.close();
});

test('selecting emoji from non-default category updates self', async ({ browser }) => {
    const user = await connectUser(browser);

    await user.page.locator('#peers article.self .peer-emoji').click();

    const foodTab = user.page.locator('.emoji-picker-tab').nth(5);
    await foodTab.click();

    const foodEmoji = user.page.locator('.emoji-picker-grid .emoji-picker-item').first();
    const newEmoji = await foodEmoji.textContent();
    await foodEmoji.click();

    await expect(user.page.locator('.emoji-picker')).toHaveCount(0);
    await expect(user.page.locator('#peers article.self .peer-emoji')).toHaveText(newEmoji);

    await user.context.close();
});

test('selecting emoji from non-default category propagates to peer', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await user1.page.locator('#peers article.self .peer-emoji').click();

    const animalsTab = user1.page.locator('.emoji-picker-tab').nth(3);
    await animalsTab.click();

    const animalEmoji = user1.page.locator('.emoji-picker-grid .emoji-picker-item').first();
    const newEmoji = await animalEmoji.textContent();
    await animalEmoji.click();

    const peerEmoji = user2.page.locator('#peers article:not(.self) .peer-emoji').first();
    await expect(peerEmoji).toHaveText(newEmoji, { timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
});

test('clicking self name opens inline text input', async ({ browser }) => {
    const user = await connectUser(browser);

    await user.page.locator('#peers article.self .peer-name').click();
    const input = user.page.locator('#peers article.self .peer-name input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('maxlength', '64');

    await user.context.close();
});

test('entering new name updates self entry', async ({ browser }) => {
    const user = await connectUser(browser);

    await user.page.locator('#peers article.self .peer-name').click();
    const input = user.page.locator('#peers article.self .peer-name input');
    await input.fill('Test Name');
    await input.press('Enter');

    await expect(user.page.locator('#peers article.self .peer-name')).toHaveText('Test Name');
    await expect(user.page.locator('#peers article.self .peer-name input')).toHaveCount(0);

    await user.context.close();
});

test('name change propagates to other user', async ({ browser }) => {
    const user1 = await connectUser(browser);
    const user2 = await connectUser(browser);

    await user1.page.locator('#peers article.self .peer-name').click();
    const input = user1.page.locator('#peers article.self .peer-name input');
    await input.fill('New Name');
    await input.press('Enter');

    const peerName = user2.page.locator('#peers article:not(.self) .peer-name').first();
    await expect(peerName).toHaveText('New Name', { timeout: 5000 });

    await user1.context.close();
    await user2.context.close();
});

test('escape cancels name edit', async ({ browser }) => {
    const user = await connectUser(browser);

    const nameEl = user.page.locator('#peers article.self .peer-name');
    const originalName = await nameEl.textContent();

    await nameEl.click();
    const input = user.page.locator('#peers article.self .peer-name input');
    await input.fill('Cancelled Name');
    await input.press('Escape');

    await expect(nameEl).toHaveText(originalName);
    await expect(user.page.locator('#peers article.self .peer-name input')).toHaveCount(0);

    await user.context.close();
});
