import { browser } from 'wxt/browser';

export const DEFAULT_MODEL = 'openrouter/owl-alpha';

const SETTINGS_KEY = 'tabsTabsTabs.openRouterSettings';
const LEGACY_DEFAULT_MODELS = new Set(['openai/gpt-4o-mini']);

export interface OpenRouterSettings {
  apiKey: string;
  model: string;
}

export async function getOpenRouterSettings(): Promise<OpenRouterSettings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveOpenRouterSettings(settings: Partial<OpenRouterSettings>): Promise<OpenRouterSettings> {
  const normalizedSettings = normalizeSettings(settings);
  await browser.storage.local.set({
    [SETTINGS_KEY]: normalizedSettings,
  });
  return normalizedSettings;
}

export function normalizeSettings(value: unknown): OpenRouterSettings {
  const record = isRecord(value) ? value : {};
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : '';
  const model = typeof record.model === 'string' ? record.model.trim() : '';

  return {
    apiKey,
    model: !model || LEGACY_DEFAULT_MODELS.has(model) ? DEFAULT_MODEL : model,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
