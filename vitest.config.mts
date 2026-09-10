import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: {
        alias: {
            // react-native/index.js là Flow, Node không parse được — service nào
            // import Platform từ đó sẽ làm vỡ cả file test. Xem test/stubs.
            'react-native': fileURLToPath(new URL('./test/stubs/react-native.ts', import.meta.url)),
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
});
