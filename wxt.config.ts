import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Tabs Tabs Tabs',
    description: 'Organize abas do navegador em grupos gerados por IA com sua chave do OpenRouter.',
    action: {
      default_title: 'Tabs Tabs Tabs',
    },
    permissions: ['storage', 'tabs', 'tabGroups'],
    host_permissions: ['https://openrouter.ai/*'],
  },
});
