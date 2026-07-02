import { defineConfig } from 'wxt';

const DEFAULT_BACKEND_HTTP_URL = 'http://localhost:4000';
const DEFAULT_SYNC_SOCKET_URL = 'ws://localhost:4000/socket';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Tabs Tabs Tabs',
    description: 'Organize abas do navegador em grupos gerados por IA.',
    action: {
      default_title: 'Tabs Tabs Tabs',
    },
    permissions: ['storage', 'tabs', 'tabGroups', 'identity'],
    host_permissions: buildHostPermissions(),
  },
});

function buildHostPermissions(): string[] {
  return [
    'http://localhost:4000/*',
    'http://127.0.0.1:4000/*',
    hostPermissionForUrl(process.env.WXT_BACKEND_HTTP_URL || DEFAULT_BACKEND_HTTP_URL),
    hostPermissionForUrl(process.env.WXT_SYNC_SOCKET_URL || DEFAULT_SYNC_SOCKET_URL),
  ].filter((permission, index, permissions): permission is string => {
    return Boolean(permission) && permissions.indexOf(permission) === index;
  });
}

function hostPermissionForUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}
