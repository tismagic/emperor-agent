import { defineConfig } from '@playwright/test'

const python = process.env.PYTHON || '.venv/bin/python'

export default defineConfig({
  testDir: './tests/visual',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `cd .. && ${python} -m agent.webui --host 127.0.0.1 --port 8765 --no-open`,
      url: 'http://127.0.0.1:8765/api/bootstrap',
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      command: 'npm run dev:renderer -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
})
