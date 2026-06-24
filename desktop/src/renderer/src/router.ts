import { createMemoryHistory, createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

export const routeRecords: RouteRecordRaw[] = [
  { path: '/', redirect: '/chat' },
  {
    path: '/chat',
    name: 'chat',
    component: () => import('./views/ChatView.vue'),
    meta: { label: 'Chat', hint: '御前对话' },
  },
  {
    path: '/model',
    name: 'model',
    component: () => import('./views/ModelView.vue'),
    meta: { label: 'Model', hint: '模型厂家' },
  },
  {
    path: '/tokens',
    name: 'tokens',
    component: () => import('./views/TokensView.vue'),
    meta: { label: 'Tokens', hint: '用量账本' },
  },
  {
    path: '/plugins',
    redirect: '/plugins/skills',
  },
  {
    path: '/plugins/:tab?',
    name: 'plugins',
    component: () => import('./views/PluginsView.vue'),
    meta: { label: '插件', hint: 'Skills 与 Tools' },
  },
  {
    path: '/skills/:name?',
    name: 'skills',
    component: () => import('./views/SkillsView.vue'),
    meta: { label: 'Skills', hint: '能力包' },
  },
  {
    path: '/tools',
    name: 'tools',
    component: () => import('./views/ToolsView.vue'),
    meta: { label: 'Tools', hint: '工具权限' },
  },
  {
    path: '/team',
    redirect: '/chat',
  },
  {
    path: '/project',
    name: 'project',
    component: () => import('./views/ProjectExecutionView.vue'),
    meta: { label: '项目执行', hint: '计划执行与复核' },
  },
  {
    path: '/scheduler',
    name: 'scheduler',
    component: () => import('./views/SchedulerView.vue'),
    meta: { label: '定时任务', hint: '定时任务' },
  },
  {
    path: '/configs',
    name: 'configs',
    component: () => import('./views/ConfigsView.vue'),
    meta: { label: '配置文件', hint: '配置文件' },
  },
  {
    path: '/mcp',
    name: 'mcp',
    component: () => import('./views/McpView.vue'),
    meta: { label: 'MCP', hint: '外部工具' },
  },
  {
    path: '/settings',
    redirect: '/settings/general',
  },
  {
    path: '/settings/:section?',
    name: 'settings',
    component: () => import('./views/SettingsView.vue'),
    meta: { label: '设置', hint: '应用设置', hideAppSidebar: true },
  },
  {
    path: '/memory',
    name: 'memory',
    component: () => import('./views/MemoryView.vue'),
    meta: { label: 'Memory', hint: '记忆层' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/chat' },
]

export const router = createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes: routeRecords,
})

export const navOrder = ['chat', 'plugins', 'project', 'scheduler', 'settings'] as const
export type NavRouteName = (typeof navOrder)[number]
