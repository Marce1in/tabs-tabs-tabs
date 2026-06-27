import { browser } from 'wxt/browser';

import type { OpenRouterSettings } from './settings';

export type ExtensionRequest =
  | { type: 'settings:get' }
  | { type: 'settings:save'; settings: Partial<OpenRouterSettings> }
  | { type: 'organize:run' }
  | { type: 'sync:status:get' };

export interface SettingsResponse {
  settings: OpenRouterSettings;
  hasApiKey: boolean;
}

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

export async function sendExtensionMessage<TResponse>(message: ExtensionRequest): Promise<TResponse> {
  return browser.runtime.sendMessage(message) as Promise<TResponse>;
}
