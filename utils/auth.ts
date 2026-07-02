import { browser } from 'wxt/browser';

const DEFAULT_BACKEND_HTTP_URL = 'http://localhost:4000';
const AUTH_STATE_KEY = 'tabsTabsTabs.githubAuth';

export interface GitHubAuthState {
  token: string;
  expiresAt: string;
  userId: string;
  login: string;
  name: string;
  avatarUrl: string;
}

interface IdentityApi {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string>;
}

export async function startGitHubAuth(): Promise<GitHubAuthState> {
  const identity = getIdentityApi();
  const extensionRedirectUri = identity.getRedirectURL('github');
  const startResponse = await requestGitHubAuthorizeUrl(extensionRedirectUri);

  const callbackUrl = await identity.launchWebAuthFlow({
    url: startResponse.authorizeUrl,
    interactive: true,
  });

  const authState = parseAuthCallbackUrl(callbackUrl);
  await saveGitHubAuthState(authState);
  return authState;
}

export async function getGitHubAuthState(): Promise<GitHubAuthState | null> {
  const stored = await browser.storage.local.get(AUTH_STATE_KEY);
  const authState = normalizeAuthState(stored[AUTH_STATE_KEY]);

  if (!authState) return null;
  if (Date.parse(authState.expiresAt) <= Date.now()) {
    await clearGitHubAuthState();
    return null;
  }

  return authState;
}

export async function clearGitHubAuthState(): Promise<void> {
  await browser.storage.local.remove(AUTH_STATE_KEY);
}

export function parseAuthCallbackUrl(callbackUrl: string): GitHubAuthState {
  const url = new URL(callbackUrl);
  const params = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const error = params.get('error');
  if (error) throw new Error(`Falha ao entrar com GitHub: ${error}`);

  const authState = normalizeAuthState({
    token: params.get('token'),
    expiresAt: params.get('expiresAt'),
    userId: params.get('userId'),
    login: params.get('login'),
    name: params.get('name') ?? '',
    avatarUrl: params.get('avatarUrl') ?? '',
  });

  if (!authState) throw new Error('O backend retornou uma resposta de login inválida.');
  return authState;
}

function normalizeAuthState(value: unknown): GitHubAuthState | null {
  if (!isRecord(value)) return null;

  const token = readNonEmptyString(value.token);
  const expiresAt = readNonEmptyString(value.expiresAt);
  const userId = readNonEmptyString(value.userId);
  const login = readNonEmptyString(value.login);

  if (!token || !expiresAt || !userId || !login || Number.isNaN(Date.parse(expiresAt))) return null;

  return {
    token,
    expiresAt,
    userId,
    login,
    name: typeof value.name === 'string' ? value.name : '',
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : '',
  };
}

async function saveGitHubAuthState(authState: GitHubAuthState): Promise<void> {
  await browser.storage.local.set({ [AUTH_STATE_KEY]: authState });
}

async function requestGitHubAuthorizeUrl(extensionRedirectUri: string): Promise<{ authorizeUrl: string }> {
  const response = await fetch(`${getBackendHttpUrl()}/api/auth/github/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ extensionRedirectUri }),
  });

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !isRecord(body) || typeof body.authorizeUrl !== 'string') {
    const reason = isRecord(body) && typeof body.error === 'string' ? body.error : 'backend_unavailable';
    throw new Error(`Não foi possível iniciar o login com GitHub: ${reason}`);
  }

  return { authorizeUrl: body.authorizeUrl };
}

function getIdentityApi(): IdentityApi {
  const identity = (browser as unknown as { identity?: Partial<IdentityApi> }).identity;

  if (
    typeof identity?.getRedirectURL !== 'function' ||
    typeof identity.launchWebAuthFlow !== 'function'
  ) {
    throw new Error('A API de login do navegador não está disponível.');
  }

  return identity as IdentityApi;
}

function getBackendHttpUrl(): string {
  const envUrl = import.meta.env.WXT_BACKEND_HTTP_URL;
  return typeof envUrl === 'string' && envUrl.trim()
    ? envUrl.trim().replace(/\/+$/, '')
    : DEFAULT_BACKEND_HTTP_URL;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
