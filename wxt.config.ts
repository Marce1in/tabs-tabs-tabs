import { defineConfig } from 'wxt';

const DEFAULT_BACKEND_HTTP_URL = 'http://localhost:4000';
const DEFAULT_SYNC_SOCKET_URL = 'ws://localhost:4000/socket';

// Public key that pins the extension ID to `liafoemlclglbogonogjffloegilkmgh` on
// every machine, so the OAuth redirect URI accepted by the backend
// (EXTENSION_REDIRECT_URIS) stays the same regardless of where the extension
// is loaded from. Only the public half of the keypair — safe to commit.
const CHROME_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1ZVR/NkcyIxDUli2sTpEsOrtyX0H6Ad1CoQ2e/fVHZCe77v6IN9NTW/lzUOR8xLbySlS1V9jt/vykH7kLFydETEIZorNEgIBtyhP9vRlbOD51ALpTMnPx44S3GqMLT+yYUVlQjnbbNcxIrAkLQjFfwi3Oi7pWEytNX0HiWmobRV6EMnqR6G1Zt1QpS1viCDAJRpE9ZW4ihgS0agzX2O8w6Bb3I8/W/mrQ/C+YlHrBx+4W0s3Tj9vjIq0YDFWtejhNq25zUARimjPOmUbBpb0zY7J1OzjvS9eE9CZC6lnsS4SriB/Gww+/Cb4q2+9XsMwWK0okoAM6yfKVIn21x/uRQIDAQAB';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: ({ browser }) => ({
    name: 'Tabs Tabs Tabs',
    description: 'Organize abas do navegador em grupos gerados por IA.',
    action: {
      default_title: 'Tabs Tabs Tabs',
    },
    permissions: ['storage', 'tabs', 'tabGroups', 'identity'],
    host_permissions: buildHostPermissions(),
    ...(browser === 'firefox' ? {} : { key: CHROME_EXTENSION_KEY }),
  }),
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
