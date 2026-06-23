import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const screenshotDir = resolve(process.cwd(), 'screenshots', 'codex-v2')
const visualProjectDir = resolve(process.cwd(), 'screenshots', 'fixtures', 'visual-build-project')
const backendBase = 'http://127.0.0.1:8765'

test.beforeAll(() => {
  mkdirSync(screenshotDir, { recursive: true })
  mkdirSync(visualProjectDir, { recursive: true })
  writeFileSync(resolve(visualProjectDir, 'README.md'), '# Visual Build Project\n', 'utf8')
})

const scenarios = [
  { name: 'chat-empty-desktop', path: '/chat', width: 1440, height: 900, selector: '.composer' },
  { name: 'chat-empty-mobile', path: '/chat', width: 390, height: 844, selector: '.composer' },
  { name: 'build-project-sidebar', path: '/chat', width: 1440, height: 900, selector: '.project-row' },
  { name: 'model-panel', path: '/model', width: 1024, height: 768, selector: '.view-body' },
  { name: 'tokens-panel', path: '/tokens', width: 1024, height: 768, selector: '.tokens-body' },
  { name: 'memory-context-panel', path: '/memory', width: 1024, height: 768, selector: '.memory-context-strip' },
  { name: 'scheduler-panel', path: '/scheduler', width: 1280, height: 820, selector: '.scheduler-panel' },
  { name: 'plugins-panel', path: '/plugins/skills', width: 1024, height: 768, selector: '.segmented-control' },
  { name: 'settings-panel', path: '/settings/general', width: 1024, height: 768, selector: '.settings-shell' },
  { name: 'settings-model', path: '/settings/model', width: 1024, height: 768, selector: '.model-panel-shell' },
  { name: 'settings-appearance', path: '/settings/appearance', width: 1024, height: 768, selector: '.settings-shell' },
] as const

for (const scenario of scenarios) {
  test(`captures ${scenario.name}`, async ({ page, request }) => {
    await ensureVisualBuildSessions(request)
    await page.setViewportSize({ width: scenario.width, height: scenario.height })
    await page.goto(scenario.path)
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator(scenario.selector).first()).toBeVisible()
    if (scenario.path.startsWith('/settings')) {
      await expect(page.locator('.codex-sidebar')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Team/i })).toHaveCount(0)
    }
    if (scenario.path === '/settings/model') {
      await expect(page.getByText('Context Window').first()).toBeVisible()
      await expect(page.getByText('Max Tokens').first()).toBeVisible()
    }
    await expect(page.locator('body')).not.toContainText('Web UI 启动失败')
    await page.waitForTimeout(650)
    await page.screenshot({
      path: resolve(screenshotDir, `${scenario.name}.png`),
      fullPage: false,
    })
  })
}

test('captures sidebar search overlay', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/chat')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.getByPlaceholder('搜索对话').fill('Visual')
  await expect(page.locator('.sidebar-search-panel')).toBeVisible()
  await page.screenshot({
    path: resolve(screenshotDir, 'sidebar-search-overlay.png'),
    fullPage: false,
  })
})

test('captures composer mode menu on desktop', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/chat')
  await expect(page.locator('.composer')).toBeVisible()
  await page.locator('.mode-button').click()
  await assertFloatingModeMenu(page)
  await page.screenshot({
    path: resolve(screenshotDir, 'composer-mode-menu-desktop.png'),
    fullPage: false,
  })
})

test('captures composer add menu on desktop', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/chat')
  await expect(page.locator('.composer')).toBeVisible()
  await assertComposerShellTrimmed(page)
  await page.locator('.attach-button').click()
  await assertComposerAddMenu(page)
  await page.screenshot({
    path: resolve(screenshotDir, 'composer-add-menu-desktop.png'),
    fullPage: false,
  })
})

test('captures composer add menu on mobile', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/chat')
  await expect(page.locator('.composer')).toBeVisible()
  await assertComposerShellTrimmed(page)
  await page.locator('.attach-button').click()
  await assertComposerAddMenu(page)
  await page.screenshot({
    path: resolve(screenshotDir, 'composer-add-menu-mobile.png'),
    fullPage: false,
  })
})

test('captures composer mode menu on mobile', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/chat')
  await expect(page.locator('.composer')).toBeVisible()
  await page.locator('.mode-button').click()
  await assertFloatingModeMenu(page)
  await page.screenshot({
    path: resolve(screenshotDir, 'composer-mode-menu-mobile.png'),
    fullPage: false,
  })
})

test('captures composer model menu on desktop', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/chat')
  await expect(page.locator('.composer')).toBeVisible()
  await page.locator('.model-button').click()
  await assertFloatingModelMenu(page)
  await page.screenshot({
    path: resolve(screenshotDir, 'composer-model-menu-desktop.png'),
    fullPage: false,
  })
})

test('captures composer model menu on mobile', async ({ page, request }) => {
  await ensureVisualBuildSessions(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/chat')
  await expect(page.locator('.composer')).toBeVisible()
  await page.locator('.model-button').click()
  await assertFloatingModelMenu(page)
  await page.screenshot({
    path: resolve(screenshotDir, 'composer-model-menu-mobile.png'),
    fullPage: false,
  })
})

async function ensureVisualBuildSessions(request: APIRequestContext) {
  const projectRes = await request.post(`${backendBase}/api/projects/resolve`, {
    data: { path: visualProjectDir },
  })
  expect(projectRes.ok()).toBeTruthy()
  const project = await projectRes.json()
  const sessionsRes = await request.get(`${backendBase}/api/sessions`)
  expect(sessionsRes.ok()).toBeTruthy()
  const sessions = await sessionsRes.json() as Array<Record<string, unknown>>
  for (const title of ['构建 Visual UI', '构建 Visual API']) {
    const exists = sessions.some((session) =>
      session.title === title && session.project_id === project.project_id,
    )
    if (!exists) {
      const created = await request.post(`${backendBase}/api/sessions`, {
        data: { title, mode: 'build', project },
      })
      expect(created.ok()).toBeTruthy()
    }
  }
  const missingExists = sessions.some((session) => session.project_id === 'missing_visual_project')
  if (!missingExists) {
    const created = await request.post(`${backendBase}/api/sessions`, {
      data: {
        title: '缺失项目路径',
        mode: 'build',
        project: {
          project_id: 'missing_visual_project',
          project_path: resolve(visualProjectDir, 'missing'),
          project_name: 'Missing visual project',
        },
      },
    })
    expect(created.ok()).toBeTruthy()
  }
}

async function assertComposerShellTrimmed(page: Page) {
  await expect(page.locator('.slash-hint-button')).toHaveCount(0)

  const actionRowBorderTop = await page.locator('.composer-action-row').evaluate((el) =>
    window.getComputedStyle(el).borderTopWidth,
  )
  expect(actionRowBorderTop).toBe('0px')

  const contextRing = page.locator('.context-ring')
  if (await contextRing.count()) {
    const box = await contextRing.first().boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(19)
      expect(box.width).toBeLessThanOrEqual(21)
      expect(box.height).toBeGreaterThanOrEqual(19)
      expect(box.height).toBeLessThanOrEqual(21)
    }
    await expect(contextRing.locator('.ring-arc')).toHaveAttribute('stroke', 'currentColor')
  }

  const modelButton = page.locator('.model-button')
  if (await modelButton.count()) {
    await expect(modelButton.locator('.model-button-label')).toBeVisible()
    await expect(modelButton.locator('.model-button-meta')).toHaveCount(1)
    const viewport = page.viewportSize()
    if ((viewport?.width || 0) > 820) {
      await expect(modelButton.locator('.model-button-meta').first()).toBeVisible()
      await expect(modelButton).toContainText('·')
      await expect(modelButton).not.toContainText(/\b\d+k\b|1M|输出上限/)
    }
    if (await contextRing.count()) {
      const contextBox = await contextRing.first().boundingBox()
      const modelBox = await modelButton.first().boundingBox()
      expect(contextBox).not.toBeNull()
      expect(modelBox).not.toBeNull()
      if (contextBox && modelBox) {
        expect(contextBox.x).toBeLessThan(modelBox.x)
      }
    }
  }
}

async function assertFloatingModeMenu(page: Page) {
  const menu = page.locator('.mode-menu')
  await expect(menu).toBeVisible()
  await expect(page.locator('.mode-option')).toHaveCount(3)

  const position = await menu.evaluate((el) => window.getComputedStyle(el).position)
  expect(position).toBe('fixed')

  const menuBox = await menu.boundingBox()
  const viewport = page.viewportSize()
  expect(menuBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!menuBox || !viewport) return

  expect(menuBox.x).toBeGreaterThanOrEqual(8)
  expect(menuBox.y).toBeGreaterThanOrEqual(8)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 8)

  const hit = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.mode-menu')),
    {
      x: menuBox.x + menuBox.width / 2,
      y: menuBox.y + menuBox.height / 2,
    },
  )
  expect(hit).toBeTruthy()
}

async function assertFloatingModelMenu(page: Page) {
  const menu = page.locator('.model-menu')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.model-menu-head')).toContainText('模型与思考')
  await expect(menu).not.toContainText('上下文窗口')
  await expect(menu).not.toContainText('输出上限')
  await expect(menu).not.toContainText(/\b\d+k\b|1M/)
  await expect(menu.locator('.reasoning-control')).toBeVisible()
  await expect(menu.locator('.reasoning-choice')).toHaveCount(5)
  await expect(menu.locator('.model-option').first()).toBeVisible()
  await expect(menu.locator('.model-option').first().locator('.model-option-meta')).toBeVisible()

  const position = await menu.evaluate((el) => window.getComputedStyle(el).position)
  expect(position).toBe('fixed')

  const menuBox = await menu.boundingBox()
  const viewport = page.viewportSize()
  expect(menuBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!menuBox || !viewport) return

  expect(menuBox.x).toBeGreaterThanOrEqual(8)
  expect(menuBox.y).toBeGreaterThanOrEqual(8)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height - 8)

  const hit = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.model-menu')),
    {
      x: menuBox.x + menuBox.width / 2,
      y: menuBox.y + menuBox.height / 2,
    },
  )
  expect(hit).toBeTruthy()
}

async function assertComposerAddMenu(page: Page) {
  const menu = page.locator('.composer-palette')
  const composer = page.locator('.composer')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.composer-palette-item').first()).toContainText('Files and folders')
  await expect(menu.locator('.composer-palette-item-icon').first()).toBeVisible()

  const menuBox = await menu.boundingBox()
  const composerBox = await composer.boundingBox()
  const viewport = page.viewportSize()
  expect(menuBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!menuBox || !composerBox || !viewport) return

  expect(menuBox.x).toBeGreaterThanOrEqual(8)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width - 8)
  expect(Math.abs(menuBox.width - composerBox.width)).toBeLessThanOrEqual(24)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(composerBox.y - 6)
}
