import { browser } from 'wxt/browser';

import {
  type AuthStatusResponse,
  type ExtensionRequest,
  type OrganizationRunResponse,
  type SyncStatusResponse,
} from '@/utils/messages';
import { clearGitHubAuthState, getGitHubAuthState, startGitHubAuth } from '@/utils/auth';
import { clearStoredSyncMetadata, createTabSyncController, type TabSyncController } from '@/utils/tab-sync';

let tabSyncController: TabSyncController | null = null;

export default defineBackground(() => {
  tabSyncController = createTabSyncController();

  browser.runtime.onMessage.addListener((message) => {
    if (!isExtensionRequest(message)) return undefined;
    return handleExtensionMessage(message);
  });

  void tabSyncController.start();
});

async function handleExtensionMessage(
  message: ExtensionRequest,
): Promise<OrganizationRunResponse | SyncStatusResponse | AuthStatusResponse> {
  switch (message.type) {
    case 'auth:status:get':
      return getAuthStatusResponse();

    case 'auth:github:start': {
      const auth = await startGitHubAuth();
      await clearStoredSyncMetadata();
      await tabSyncController?.restart();
      return { auth };
    }

    case 'auth:logout':
      await clearGitHubAuthState();
      await clearStoredSyncMetadata();
      tabSyncController?.stop();
      return { auth: null };

    case 'organize:run':
      return organizeAndApply();

    case 'sync:status:get':
      return getSyncStatusResponse();
  }
}

async function getAuthStatusResponse(): Promise<AuthStatusResponse> {
  return { auth: await getGitHubAuthState() };
}

async function organizeAndApply(): Promise<OrganizationRunResponse> {
  if (!tabSyncController) throw new Error('Sync ainda não inicializado.');
  return tabSyncController.organizeNow();
}

async function getSyncStatusResponse(): Promise<SyncStatusResponse> {
  return (
    tabSyncController?.getStatus() ?? {
      clientId: '',
      state: 'idle',
      message: 'Sync ainda não inicializado.',
      globalTabs: 0,
      connectedClients: 0,
      lastSyncedAt: '',
    }
  );
}

function isExtensionRequest(message: unknown): message is ExtensionRequest {
  if (!isRecord(message) || typeof message.type !== 'string') return false;
  return [
    'organize:run',
    'sync:status:get',
    'auth:status:get',
    'auth:github:start',
    'auth:logout',
  ].includes(message.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
