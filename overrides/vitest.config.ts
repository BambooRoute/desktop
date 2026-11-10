import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['apps/desktop/tests/bamboo-welcome.client.spec.tsx', 'apps/desktop/tests/welcome-host.spec.ts', 'apps/desktop/tests/bamboo-catalog.client.spec.tsx'],
  },
})
