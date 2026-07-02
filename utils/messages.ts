import { browser } from 'wxt/browser';

import type { GitHubAuthState } from './auth';

export type ExtensionRequest =
  | { type: 'organize:run' }
  | { type: 'sync:status:get' }
  | { type: 'auth:status:get' }
  | { type: 'auth:github:start' }
  | { type: 'auth:logout' };

export interface OrganizationRunResponse {
  tabsAnalyzed: number;
  model: string;
  generatedAt: string;
  warnings: string[];
  appliedGroups: number;
  groupedTabs: number;
  ungroupedTabs: number;
  skippedTabs: number;
}

export interface SyncStatusResponse {
  clientId: string;
  state: 'idle' | 'connecting' | 'connected' | 'reconciling' | 'disconnected' | 'error';
  message: string;
  globalTabs: number;
  connectedClients: number;
  lastSyncedAt: string;
}

export interface AuthStatusResponse {
  auth: GitHubAuthState | null;
}

export async function sendExtensionMessage<TResponse>(message: ExtensionRequest): Promise<TResponse> {
  return browser.runtime.sendMessage(message) as Promise<TResponse>;
}
