import { browser, type Browser } from 'wxt/browser';

import {
  type ExtensionRequest,
  type OrganizationRunResponse,
  type SettingsResponse,
} from '@/utils/messages';
import { requestOrganizationPlan } from '@/utils/openrouter';
import { getOpenRouterSettings, saveOpenRouterSettings } from '@/utils/settings';
import {
  countGroupedTabs,
  normalizeOrganizationPlan,
  toSanitizedTab,
  type OrganizationPlan,
  type SanitizedTab,
} from '@/utils/tab-organizer';

const TAB_GROUP_ID_NONE = -1;
const AUTO_ORGANIZE_ALARM = 'tabs-tabs-tabs:auto-organize';
const AUTO_ORGANIZE_PERIOD_MINUTES = 5;
const TAB_TITLE_SIGNATURE_KEY = 'tabsTabsTabs.lastTabTitleSignature';

let isAutoOrganizing = false;

interface ApplyOrganizationResult {
  appliedGroups: number;
  groupedTabs: number;
  ungroupedTabs: number;
  skippedTabs: number;
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message) => {
    if (!isExtensionRequest(message)) return undefined;
    return handleExtensionMessage(message);
  });

  browser.runtime.onInstalled.addListener(() => {
    void ensureAutoOrganizeAlarm();
  });
  browser.runtime.onStartup?.addListener(() => {
    void ensureAutoOrganizeAlarm();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_ORGANIZE_ALARM) {
      void autoOrganizeIfTabsChanged();
    }
  });

  void ensureAutoOrganizeAlarm();
  void seedInitialTabTitleSignature();
});

async function handleExtensionMessage(
  message: ExtensionRequest,
): Promise<SettingsResponse | OrganizationRunResponse> {
  switch (message.type) {
    case 'settings:get':
      return getSettingsResponse();

    case 'settings:save': {
      const settings = await saveOpenRouterSettings(message.settings);
      return {
        settings,
        hasApiKey: Boolean(settings.apiKey),
      };
    }

    case 'organize:run':
      return organizeAndApply();
  }
}

async function getSettingsResponse(): Promise<SettingsResponse> {
  const settings = await getOpenRouterSettings();
  return {
    settings,
    hasApiKey: Boolean(settings.apiKey),
  };
}

async function organizeAndApply(): Promise<OrganizationRunResponse> {
  const settings = await getOpenRouterSettings();
  if (!settings.apiKey) {
    throw new Error('Adicione sua chave da API do OpenRouter antes de organizar as abas.');
  }

  const tabs = await collectEligibleTabs();
  if (tabs.length < 2) {
    throw new Error('Abra pelo menos duas abas não fixadas na janela atual primeiro.');
  }

  const { plan, warnings } = await requestOrganizationPlan({
    settings,
    tabs,
  });
  const result = await applyOrganizationPlan(plan);
  await saveTabTitleSignature(buildTabTitleSignature(tabs));

  return {
    ...result,
    tabsAnalyzed: tabs.length,
    model: settings.model,
    generatedAt: new Date().toISOString(),
    warnings,
  };
}

async function autoOrganizeIfTabsChanged(): Promise<void> {
  if (isAutoOrganizing) return;

  isAutoOrganizing = true;

  try {
    const settings = await getOpenRouterSettings();
    if (!settings.apiKey) return;

    const tabs = await collectEligibleTabs();
    if (tabs.length < 2) {
      await saveTabTitleSignature(buildTabTitleSignature(tabs));
      return;
    }

    const currentSignature = buildTabTitleSignature(tabs);
    const previousSignature = await getSavedTabTitleSignature();
    if (!previousSignature) {
      await saveTabTitleSignature(currentSignature);
      return;
    }
    if (currentSignature === previousSignature) return;

    const { plan } = await requestOrganizationPlan({
      settings,
      tabs,
    });
    await applyOrganizationPlan(plan);
    await saveTabTitleSignature(currentSignature);
  } catch (error) {
    console.warn('Falha ao organizar abas automaticamente.', error);
  } finally {
    isAutoOrganizing = false;
  }
}

async function ensureAutoOrganizeAlarm(): Promise<void> {
  const existingAlarm = await browser.alarms.get(AUTO_ORGANIZE_ALARM);
  if (existingAlarm) return;

  await browser.alarms.create(AUTO_ORGANIZE_ALARM, {
    delayInMinutes: AUTO_ORGANIZE_PERIOD_MINUTES,
    periodInMinutes: AUTO_ORGANIZE_PERIOD_MINUTES,
  });
}

async function seedInitialTabTitleSignature(): Promise<void> {
  const existingSignature = await getSavedTabTitleSignature();
  if (existingSignature) return;

  try {
    const tabs = await collectEligibleTabs();
    await saveTabTitleSignature(buildTabTitleSignature(tabs));
  } catch {
    // The browser may not have a normal focused window when the service worker starts.
  }
}

async function applyOrganizationPlan(plan: OrganizationPlan): Promise<ApplyOrganizationResult> {
  assertTabGroupApisAvailable();

  const liveBrowserTabs = await collectEligibleBrowserTabs();
  const liveTabIds = liveBrowserTabs.map((tab) => tab.id).filter(isInteger);
  const normalizedPlan = normalizeOrganizationPlan(plan, liveTabIds).plan;
  const groupedTabs = countGroupedTabs(normalizedPlan);

  if (normalizedPlan.groups.length === 0 || groupedTabs === 0) {
    throw new Error('Não há grupos de abas válidos para aplicar.');
  }

  const currentlyGroupedTabIds = liveBrowserTabs
    .filter((tab) => tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE)
    .map((tab) => tab.id)
    .filter(isInteger);

  if (currentlyGroupedTabIds.length > 0) {
    await browser.tabs.ungroup(toTabsApiTabIds(currentlyGroupedTabIds));
  }

  let appliedGroups = 0;
  for (const group of normalizedPlan.groups) {
    if (group.tabIds.length === 0) continue;

    const groupId = await (browser.tabs.group({
      tabIds: toTabsApiTabIds(group.tabIds),
    }) as unknown as Promise<number>);

    await browser.tabGroups.update(groupId, {
      title: group.name,
      color: group.color,
    });

    appliedGroups += 1;
  }

  return {
    appliedGroups,
    groupedTabs,
    ungroupedTabs: normalizedPlan.ungroupedTabIds.length,
    skippedTabs: Math.max(0, liveTabIds.length - groupedTabs - normalizedPlan.ungroupedTabIds.length),
  };
}

async function collectEligibleTabs(): Promise<SanitizedTab[]> {
  const browserTabs = await collectEligibleBrowserTabs();
  return browserTabs
    .map((tab) =>
      toSanitizedTab({
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title,
        url: tab.url,
        pendingUrl: tab.pendingUrl,
        pinned: tab.pinned,
      }),
    )
    .filter((tab): tab is SanitizedTab => tab !== null);
}

async function collectEligibleBrowserTabs(): Promise<Browser.tabs.Tab[]> {
  const windowId = await getLastFocusedNormalWindowId();
  const tabs = await browser.tabs.query({ windowId });
  return tabs
    .filter((tab) => !tab.pinned && isInteger(tab.id))
    .sort((a, b) => a.index - b.index);
}

async function getLastFocusedNormalWindowId(): Promise<number> {
  const [activeTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!isInteger(activeTab?.windowId)) {
    throw new Error('Não foi possível encontrar a janela ativa do navegador.');
  }

  const window = await browser.windows.get(activeTab.windowId);
  if (window.type !== 'normal') {
    throw new Error('Abra uma janela normal do navegador antes de organizar as abas.');
  }

  return activeTab.windowId;
}

function assertTabGroupApisAvailable(): void {
  if (
    typeof browser.tabs.group !== 'function' ||
    typeof browser.tabs.ungroup !== 'function' ||
    typeof browser.tabGroups?.update !== 'function'
  ) {
    throw new Error('Grupos de abas não estão disponíveis neste navegador.');
  }
}

function isExtensionRequest(message: unknown): message is ExtensionRequest {
  if (!isRecord(message) || typeof message.type !== 'string') return false;
  return ['settings:get', 'settings:save', 'organize:run'].includes(message.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function toTabsApiTabIds(tabIds: number[]): number | [number, ...number[]] {
  if (tabIds.length === 1) return tabIds[0];
  return tabIds as [number, ...number[]];
}

function buildTabTitleSignature(tabs: SanitizedTab[]): string {
  return JSON.stringify(
    tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
    })),
  );
}

async function getSavedTabTitleSignature(): Promise<string> {
  const stored = await browser.storage.local.get(TAB_TITLE_SIGNATURE_KEY);
  return typeof stored[TAB_TITLE_SIGNATURE_KEY] === 'string' ? stored[TAB_TITLE_SIGNATURE_KEY] : '';
}

async function saveTabTitleSignature(signature: string): Promise<void> {
  await browser.storage.local.set({
    [TAB_TITLE_SIGNATURE_KEY]: signature,
  });
}
