import { defineConfig } from 'vitest/config';

// Testes de unidade da simulação (ambiente node, sem three.js).
// Os testes de ponta a ponta (tests/e2e, Playwright) ficam de fora de propósito.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // mostra a tabela de calibragem do robô (tests/unit/bot.test.ts) mesmo quando passa
    silent: false,
  },
});
