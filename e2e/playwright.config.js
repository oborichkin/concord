import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    testMatch: '*.spec.js',
    fullyParallel: false,
    retries: 0,
    use: {
        baseURL: 'http://localhost:3333',
        permissions: ['microphone'],
        launchOptions: {
            args: [
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
            ],
        },
    },
    webServer: {
        command: 'node test-server.js',
        port: 3333,
        reuseExistingServer: !process.env.CI,
        timeout: 10000,
    },
});
