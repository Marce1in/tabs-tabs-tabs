import { browser } from 'wxt/browser';

import type { OpenRouterSettings } from './settings';

export type ExtensionRequest =
  | { type: 'settings:get' }
  | { type: 'settings:save'; settings: Partial<OpenRouterSettings> }
  | { type: 'organize:run' };

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

export async function sendExtensionMessage<TResponse>(message: ExtensionRequest): Promise<TResponse> {
  return browser.runtime.sendMessage(message) as Promise<TResponse>;
}
