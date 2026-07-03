import { Channel, Socket } from 'phoenix';
import { browser, type Browser } from 'wxt/browser';

import { getGitHubAuthState, type GitHubAuthState } from './auth';
import type { OrganizationRunResponse, SyncStatusResponse } from './messages';
import type { TabGroupColor } from './tab-organizer';

const DEFAULT_SYNC_SOCKET_URL = 'ws://localhost:4000/socket';
const SYNC_CLIENT_ID_KEY = 'tabsTabsTabs.syncClientId';
const SYNC_WINDOW_ID_KEY = 'tabsTabsTabs.syncWindowId';
const SYNC_TAB_KEY_MAP_KEY = 'tabsTabsTabs.syncTabKeys';
const SYNC_TAB_MAP_KEY = 'tabsTabsTabs.syncTabFingerprints';
const SYNC_CREATED_TAB_IDS_KEY = 'tabsTabsTabs.syncCreatedTabIds';
const SYNC_GROUP_MAP_KEY = 'tabsTabsTabs.syncGroupKeys';
const SYNC_PUBLISH_DEBOUNCE_MS = 650;
const SYNC_PUSH_TIMEOUT_MS = 60_000;
const REMOTE_EVENT_COOLDOWN_MS = 2000;
const TAB_GROUP_ID_NONE = -1;
const TAB_GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

export interface SyncedTabPayload {
  tabKey: string;
  fingerprint: string;
  url: string;
  title: string;
  position: number;
  groupKey: string | null;
}

export interface SyncedTabGroupPayload {
  groupKey: string;
  title: string;
  color: TabGroupColor;
  position: number;
}

export interface SyncStatePayload {
  tabs: SyncedTabPayload[];
  groups: SyncedTabGroupPayload[];
}

export interface SyncUpsertPayload extends SyncStatePayload {
  originClientId?: string;
}

export interface SyncDeletePayload {
  originClientId?: string;
  tabKeys: string[];
  fingerprints: string[];
  deletedCount?: number;
}

interface LocalSyncTab extends SyncedTabPayload {
  tabId: number;
  windowId: number;
  index: number;
  groupId: number;
}

interface StoredGroupMaps {
  byLocalGroupId: Record<string, string>;
}

type SyncStatusState = SyncStatusResponse['state'];

export interface TabSyncController {
  start: () => Promise<void>;
  stop: () => void;
  restart: () => Promise<void>;
  schedulePublish: () => void;
  organizeNow: () => Promise<OrganizationRunResponse>;
  getStatus: () => SyncStatusResponse;
}

export interface RemoteStatePlan {
  openTabs: SyncedTabPayload[];
  updateTabs: RemoteTabApplication[];
  reuseTabs: RemoteTabApplication[];
  existingTabKeys: string[];
}

export interface RemoteTabApplication {
  tabId: number;
  tab: SyncedTabPayload;
}

export function createTabSyncController(): TabSyncController {
  let socket: Socket | null = null;
  let channel: Channel | null = null;
  let authState: GitHubAuthState | null = null;
  let clientId = '';
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  let isApplyingRemoteSync = false;
  let areBrowserListenersRegistered = false;
  let ignoreLocalEventsUntil = 0;
  let statusState: SyncStatusState = 'idle';
  let statusMessage = 'Sync aguardando inicialização.';
  let globalTabs = 0;
  let connectedClients = 0;
  let presenceState: Record<string, unknown> = {};
  let lastSyncedAt = '';

  async function start(): Promise<void> {
    if (socket || channel) return;

    authState = await getGitHubAuthState();
    if (!authState) {
      setStatus('idle', 'Entre com GitHub para sincronizar abas.');
      return;
    }

    clientId = await getOrCreateClientId();
    setStatus('connecting', 'Conectando ao sync.');

    socket = new Socket(getSyncSocketUrl(), {
      timeout: SYNC_PUSH_TIMEOUT_MS,
      params: {
        auth_token: authState.token,
        client_id: clientId,
        client_label: await getClientLabel(),
      },
    });

    socket.onOpen(() => setStatus('connected', 'Sync conectado.'));
    socket.onError(() => setStatus('error', 'Falha na conexão de sync.'));
    socket.onClose(() => setStatus('disconnected', 'Sync desconectado.'));

    socket.connect();
    channel = socket.channel(`tabs:user:${authState.userId}`);
    registerChannelHandlers(channel);
    joinChannel(channel);
    registerBrowserListeners();
  }

  function stop(): void {
    if (publishTimer) {
      clearTimeout(publishTimer);
      publishTimer = null;
    }

    channel?.leave();
    socket?.disconnect();
    channel = null;
    socket = null;
    authState = null;
    presenceState = {};
    connectedClients = 0;
    globalTabs = 0;
    setStatus('idle', 'Sync desconectado.');
  }

  async function restart(): Promise<void> {
    stop();
    await start();
  }

  function schedulePublish(): void {
    if (shouldIgnoreLocalEvent(isApplyingRemoteSync, ignoreLocalEventsUntil, Date.now())) return;
    if (!channel) return;

    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = null;
      void publishLocalState();
    }, SYNC_PUBLISH_DEBOUNCE_MS);
  }

  function getStatus(): SyncStatusResponse {
    return {
      clientId,
      state: statusState,
      message: statusMessage,
      globalTabs,
      connectedClients,
      lastSyncedAt,
    };
  }

  function registerChannelHandlers(activeChannel: Channel): void {
    activeChannel.on('tabs:upserted', (payload) => {
      void handleRemoteUpsert(payload);
    });

    activeChannel.on('tabs:deleted', (payload) => {
      void handleRemoteDelete(payload);
    });

    activeChannel.on('presence_state', (payload) => {
      presenceState = isRecord(payload) ? payload : {};
      connectedClients = countPresenceClients(presenceState);
    });

    activeChannel.on('presence_diff', (payload) => {
      presenceState = applyPresenceDiff(presenceState, payload);
      connectedClients = countPresenceClients(presenceState);
      void requestRemoteState();
    });
  }

  function joinChannel(activeChannel: Channel): void {
    activeChannel
      .join()
      .receive('ok', (response) => {
        setStatus('connected', 'Sync conectado.');
        void handleInitialJoin(response);
      })
      .receive('error', () => {
        setStatus('error', 'O backend recusou o channel de sync.');
      })
      .receive('timeout', () => {
        setStatus('error', 'Timeout ao entrar no channel de sync.');
      });
  }

  function registerBrowserListeners(): void {
    if (areBrowserListenersRegistered) return;

    browser.tabs.onCreated.addListener(schedulePublish);
    browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') schedulePublish();
    });
    browser.tabs.onMoved.addListener(schedulePublish);
    browser.tabs.onAttached.addListener(schedulePublish);
    browser.tabs.onDetached.addListener(schedulePublish);
    browser.tabs.onRemoved.addListener((tabId) => {
      void handleLocalTabRemoved(tabId);
    });

    const tabGroupsApi = browser.tabGroups as MaybeTabGroupsApi | undefined;
    tabGroupsApi?.onCreated?.addListener(schedulePublish);
    tabGroupsApi?.onUpdated?.addListener(schedulePublish);
    tabGroupsApi?.onMoved?.addListener(schedulePublish);
    tabGroupsApi?.onRemoved?.addListener(schedulePublish);
    areBrowserListenersRegistered = true;
  }

  async function publishLocalState(throwOnError = false): Promise<void> {
    if (shouldIgnoreLocalEvent(isApplyingRemoteSync, ignoreLocalEventsUntil, Date.now())) return;
    if (!channel || statusState === 'disconnected') return;

    try {
      const localState = await collectLocalSyncState();
      await deleteStaleKnownTabs(localState.tabs, channel);
      await saveKnownTabKeys(localState.tabs);
      await saveKnownTabFingerprints(localState.tabs);
      await saveGroupMaps(localState.groupMaps);

      const response = await pushWithReply(channel, 'tabs:upsert', {
        tabs: localState.tabs.map(stripLocalTabFields),
        groups: localState.groups,
      });

      globalTabs = readReplyState(response).tabs.length || localState.tabs.length;
      markSynced();
    } catch (error) {
      console.warn('Falha ao publicar abas locais.', error);
      setStatus('error', 'Falha ao publicar abas locais.');
      if (throwOnError) throw error;
    }
  }

  async function deleteStaleKnownTabs(localTabs: LocalSyncTab[], activeChannel: Channel): Promise<void> {
    const knownTabKeys = await getKnownTabKeys();
    const knownFingerprints = await getKnownTabFingerprints();
    const staleEntries = findStaleKnownSyncEntries(localTabs, knownTabKeys, knownFingerprints);

    if (staleEntries.tabKeys.length === 0 && staleEntries.fingerprints.length === 0) return;

    await pushWithReply(activeChannel, 'tabs:delete', {
      tabKeys: staleEntries.tabKeys,
      fingerprints: staleEntries.fingerprints,
    });

    for (const tabId of staleEntries.tabIds) {
      delete knownTabKeys[String(tabId)];
      delete knownFingerprints[String(tabId)];
    }

    await browser.storage.local.set({ [SYNC_TAB_KEY_MAP_KEY]: knownTabKeys });
    await browser.storage.local.set({ [SYNC_TAB_MAP_KEY]: knownFingerprints });

    const syncedCreatedTabIds = await getSyncedCreatedTabIds();
    for (const tabId of staleEntries.tabIds) syncedCreatedTabIds.delete(tabId);
    await saveSyncedCreatedTabIds(syncedCreatedTabIds);
  }

  async function organizeNow(): Promise<OrganizationRunResponse> {
    if (!channel) throw new Error('Entre com GitHub e aguarde o sync conectar antes de organizar.');

    await publishLocalState(true);
    const response = await pushWithReply(channel, 'tabs:organize_now', {});
    const organizationResult = readOrganizationRunResponse(response);
    await handleRemoteState(readReplyState(response));
    return organizationResult;
  }

  async function requestRemoteState(): Promise<void> {
    if (!channel) return;

    channel.push('tabs:request_state', {}).receive('ok', (response) => {
      void handleRemoteState(response);
    });
  }

  async function handleInitialJoin(payload: unknown): Promise<void> {
    const state = readSyncState(payload);
    await handleRemoteState(payload);

    if (state.tabs.length === 0) {
      setTimeout(() => {
        schedulePublish();
      }, REMOTE_EVENT_COOLDOWN_MS + 50);
    }
  }

  async function handleRemoteState(payload: unknown): Promise<void> {
    const state = readSyncState(payload);
    connectedClients = Math.max(connectedClients, countPresenceClients(payload));
    globalTabs = state.tabs.length;
    await applyRemoteState(state);
  }

  async function handleRemoteUpsert(payload: unknown): Promise<void> {
    const upsert = readSyncUpsert(payload);
    if (!upsert || upsert.originClientId === clientId) return;

    globalTabs = Math.max(globalTabs, upsert.tabs.length);
    await applyRemoteState(upsert);
  }

  async function handleRemoteDelete(payload: unknown): Promise<void> {
    const deletion = readSyncDelete(payload);
    if (!deletion || deletion.originClientId === clientId) return;

    await withRemoteApplication(async () => {
      const localTabs = await collectLocalSyncTabs();
      const tabIds = localTabs
        .filter(
          (tab) =>
            deletion.tabKeys.includes(tab.tabKey) ||
            (deletion.tabKeys.length === 0 && deletion.fingerprints.includes(tab.fingerprint)),
        )
        .map((tab) => tab.tabId);

      if (tabIds.length > 0) {
        if (tabIds.length === 1) {
          await browser.tabs.remove(tabIds[0]);
        } else {
          await browser.tabs.remove(tabIds);
        }
      }

      const knownMap = await getKnownTabFingerprints();
      const tabKeyMap = await getKnownTabKeys();
      for (const [tabId, fingerprint] of Object.entries(knownMap)) {
        if (deletion.fingerprints.includes(fingerprint)) delete knownMap[tabId];
      }
      for (const [tabId, tabKey] of Object.entries(tabKeyMap)) {
        if (deletion.tabKeys.includes(tabKey)) delete tabKeyMap[tabId];
      }
      await browser.storage.local.set({ [SYNC_TAB_MAP_KEY]: knownMap });
      await browser.storage.local.set({ [SYNC_TAB_KEY_MAP_KEY]: tabKeyMap });
      globalTabs = Math.max(0, globalTabs - Math.max(deletion.tabKeys.length, deletion.fingerprints.length));
      markSynced();
    });
  }

  async function handleLocalTabRemoved(tabId: number): Promise<void> {
    if (shouldIgnoreLocalEvent(isApplyingRemoteSync, ignoreLocalEventsUntil, Date.now()) || !channel) return;

    const knownMap = await getKnownTabFingerprints();
    const tabKeyMap = await getKnownTabKeys();
    const syncedCreatedTabIds = await getSyncedCreatedTabIds();
    const fingerprint = knownMap[String(tabId)];
    const tabKey = tabKeyMap[String(tabId)];
    if (!tabKey && !fingerprint) return;

    delete knownMap[String(tabId)];
    delete tabKeyMap[String(tabId)];
    await browser.storage.local.set({ [SYNC_TAB_MAP_KEY]: knownMap });
    await browser.storage.local.set({ [SYNC_TAB_KEY_MAP_KEY]: tabKeyMap });
    syncedCreatedTabIds.delete(tabId);
    await saveSyncedCreatedTabIds(syncedCreatedTabIds);

    channel
      .push('tabs:delete', {
        tabKeys: tabKey ? [tabKey] : [],
        fingerprints: fingerprint ? [fingerprint] : [],
      })
      .receive('ok', () => {
        markSynced();
      });
  }

  async function applyRemoteState(remoteState: SyncStatePayload): Promise<void> {
    await withRemoteApplication(async () => {
      setStatus('reconciling', 'Aplicando estado remoto.');

      const localTabs = await collectLocalSyncTabs();
      const syncedCreatedTabIds = await getSyncedCreatedTabIds();
      const duplicateTabIds = findSyncedDuplicateTabIds(localTabs, syncedCreatedTabIds);

      if (duplicateTabIds.length > 0) {
        await removeTabIds(duplicateTabIds);
        for (const tabId of duplicateTabIds) syncedCreatedTabIds.delete(tabId);
      }

      const dedupedLocalTabs = localTabs.filter((tab) => !duplicateTabIds.includes(tab.tabId));
      await deleteKnownTabFingerprints(duplicateTabIds);
      await deleteKnownTabKeys(duplicateTabIds);

      const plan = planRemoteStateApplication(dedupedLocalTabs, remoteState.tabs);
      const tabByTabKey = new Map(dedupedLocalTabs.map((tab) => [tab.tabKey, tab]));
      const targetWindowId = await getSyncTargetWindowId(dedupedLocalTabs);

      for (const { tabId, tab: remoteTab } of [...plan.reuseTabs, ...plan.updateTabs]) {
        const currentTab = dedupedLocalTabs.find((tab) => tab.tabId === tabId);
        if (!currentTab) continue;

        if (currentTab.url !== remoteTab.url) {
          await browser.tabs.update(tabId, { url: remoteTab.url }).catch(() => undefined);
        }

        tabByTabKey.set(remoteTab.tabKey, {
          ...currentTab,
          ...remoteTab,
          tabId,
          windowId: currentTab.windowId,
          index: currentTab.index,
          groupId: currentTab.groupId,
        });
      }

      for (const remoteTab of plan.openTabs) {
        const createdTab = await browser.tabs.create({
          url: remoteTab.url,
          active: false,
          ...(isInteger(targetWindowId) ? { windowId: targetWindowId } : {}),
        });

        if (isInteger(createdTab.id)) {
          syncedCreatedTabIds.add(createdTab.id);

          if (isInteger(createdTab.windowId)) {
            await saveSyncWindowId(createdTab.windowId);
          }

          tabByTabKey.set(remoteTab.tabKey, {
            ...remoteTab,
            tabId: createdTab.id,
            windowId: createdTab.windowId ?? targetWindowId ?? -1,
            index: createdTab.index ?? remoteTab.position,
            groupId: TAB_GROUP_ID_NONE,
          });
        }
      }

      await moveTabsIntoRemoteOrder(remoteState.tabs, tabByTabKey);
      await applyRemoteGroups(remoteState, tabByTabKey);
      await saveKnownTabKeys([...tabByTabKey.values()]);
      await saveKnownTabFingerprints([...tabByTabKey.values()]);
      await saveSyncedCreatedTabIds(syncedCreatedTabIds);
      globalTabs = remoteState.tabs.length;
      markSynced();
    });
  }

  async function withRemoteApplication(task: () => Promise<void>): Promise<void> {
    isApplyingRemoteSync = true;
    ignoreLocalEventsUntil = Date.now() + REMOTE_EVENT_COOLDOWN_MS;
    if (publishTimer) {
      clearTimeout(publishTimer);
      publishTimer = null;
    }

    try {
      await task();
    } finally {
      ignoreLocalEventsUntil = Date.now() + REMOTE_EVENT_COOLDOWN_MS;
      isApplyingRemoteSync = false;
      if (statusState === 'reconciling') setStatus('connected', 'Sync conectado.');
    }
  }

  function setStatus(state: SyncStatusState, message: string): void {
    statusState = state;
    statusMessage = message;
  }

  function markSynced(): void {
    lastSyncedAt = new Date().toISOString();
    setStatus('connected', 'Sync conectado.');
  }

  return {
    start,
    stop,
    restart,
    schedulePublish,
    organizeNow,
    getStatus,
  };
}

export async function clearStoredSyncMetadata(): Promise<void> {
  await browser.storage.local.remove([
    SYNC_WINDOW_ID_KEY,
    SYNC_TAB_KEY_MAP_KEY,
    SYNC_TAB_MAP_KEY,
    SYNC_CREATED_TAB_IDS_KEY,
    SYNC_GROUP_MAP_KEY,
  ]);
}

export async function collectLocalSyncState(): Promise<{
  tabs: LocalSyncTab[];
  groups: SyncedTabGroupPayload[];
  groupMaps: StoredGroupMaps;
}> {
  const localTabs = await collectLocalSyncTabs();
  const groupMaps = await getGroupMaps();
  const groupIds = [...new Set(localTabs.map((tab) => tab.groupId).filter((groupId) => groupId !== TAB_GROUP_ID_NONE))];
  const groups: SyncedTabGroupPayload[] = [];

  for (const [position, groupId] of groupIds.entries()) {
    const group = await getTabGroup(groupId);
    if (!group) continue;

    const title = normalizeGroupTitle(group.title);
    const color = normalizeGroupColor(group.color);
    const groupKey = await getOrCreateGroupKey(groupMaps, groupId, title, color, position);
    groups.push({ groupKey, title, color, position });

    for (const tab of localTabs) {
      if (tab.groupId === groupId) tab.groupKey = groupKey;
    }
  }

  return { tabs: localTabs, groups, groupMaps };
}

export async function collectLocalSyncTabs(): Promise<LocalSyncTab[]> {
  const windows = await getNormalWindowsWithTabs();
  const tabKeyMap = await getKnownTabKeys();
  const localTabs: LocalSyncTab[] = [];
  let didCreateTabKey = false;

  for (const window of windows) {
    const tabs = [...(window.tabs ?? [])].sort((a, b) => a.index - b.index);

    for (const tab of tabs) {
      if (tab.pinned || !isInteger(tab.id) || !isInteger(tab.windowId) || !isInteger(tab.index)) continue;

      const normalizedUrl = normalizeSyncUrl(tab.url ?? tab.pendingUrl);
      if (!normalizedUrl) continue;

      const storageTabId = String(tab.id);
      let tabKey = tabKeyMap[storageTabId];
      if (!tabKey) {
        tabKey = createTabKey();
        tabKeyMap[storageTabId] = tabKey;
        didCreateTabKey = true;
      }

      localTabs.push({
        tabKey,
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        fingerprint: await fingerprintForValue(normalizedUrl),
        url: normalizedUrl,
        title: normalizeTabTitle(tab.title),
        position: localTabs.length,
        groupKey: null,
        groupId: isInteger(tab.groupId) ? tab.groupId : TAB_GROUP_ID_NONE,
      });
    }
  }

  if (didCreateTabKey) {
    await browser.storage.local.set({ [SYNC_TAB_KEY_MAP_KEY]: tabKeyMap });
  }

  return localTabs;
}

export function normalizeSyncUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl?.trim()) return null;

  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;

    url.username = '';
    url.password = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

export async function fingerprintForValue(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) throw new Error('Web Crypto API indisponível para gerar fingerprint de sync.');

  const hash = await cryptoApi.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function planRemoteStateApplication(
  localTabs: Array<Pick<LocalSyncTab, 'tabId' | 'tabKey' | 'fingerprint' | 'url'>>,
  remoteTabs: SyncedTabPayload[],
): RemoteStatePlan {
  const localTabsByTabKey = new Map(localTabs.map((tab) => [tab.tabKey, tab]));
  const localTabsByFingerprint = new Map(localTabs.map((tab) => [tab.fingerprint, tab]));
  const openTabs: SyncedTabPayload[] = [];
  const updateTabs: RemoteTabApplication[] = [];
  const reuseTabs: RemoteTabApplication[] = [];
  const existingTabKeys: string[] = [];

  for (const remoteTab of [...remoteTabs].sort((a, b) => a.position - b.position)) {
    const localTabByKey = localTabsByTabKey.get(remoteTab.tabKey);
    if (localTabByKey) {
      existingTabKeys.push(remoteTab.tabKey);
      if (localTabByKey.url !== remoteTab.url) {
        updateTabs.push({ tabId: localTabByKey.tabId, tab: remoteTab });
      }
      continue;
    }

    const localTabByFingerprint = localTabsByFingerprint.get(remoteTab.fingerprint);
    if (localTabByFingerprint) {
      existingTabKeys.push(remoteTab.tabKey);
      reuseTabs.push({ tabId: localTabByFingerprint.tabId, tab: remoteTab });
      continue;
    }

    openTabs.push(remoteTab);
  }

  return {
    openTabs,
    updateTabs,
    reuseTabs,
    existingTabKeys,
  };
}

export function shouldIgnoreLocalEvent(isApplyingRemoteSync: boolean, ignoreLocalEventsUntil: number, now: number): boolean {
  return isApplyingRemoteSync || now < ignoreLocalEventsUntil;
}

export function findSyncedDuplicateTabIds(
  localTabs: Array<Pick<LocalSyncTab, 'tabId' | 'tabKey'>>,
  syncedCreatedTabIds: Set<number>,
): number[] {
  const tabsByTabKey = new Map<string, Array<Pick<LocalSyncTab, 'tabId' | 'tabKey'>>>();

  for (const tab of localTabs) {
    const tabs = tabsByTabKey.get(tab.tabKey) ?? [];
    tabs.push(tab);
    tabsByTabKey.set(tab.tabKey, tabs);
  }

  const duplicateTabIds: number[] = [];

  for (const tabs of tabsByTabKey.values()) {
    if (tabs.length < 2) continue;

    const syncedTabs = tabs.filter((tab) => syncedCreatedTabIds.has(tab.tabId));
    if (syncedTabs.length === 0) continue;

    const hasManualTab = tabs.some((tab) => !syncedCreatedTabIds.has(tab.tabId));
    duplicateTabIds.push(...(hasManualTab ? syncedTabs : syncedTabs.slice(1)).map((tab) => tab.tabId));
  }

  return duplicateTabIds;
}

export function findStaleKnownSyncEntries(
  currentTabs: Array<{ tabId: number }>,
  knownTabKeys: Record<string, string>,
  knownFingerprints: Record<string, string>,
): { tabIds: number[]; tabKeys: string[]; fingerprints: string[] } {
  const currentTabIds = new Set(currentTabs.map((tab) => String(tab.tabId)));
  const staleTabIds = new Set<string>();

  for (const tabId of Object.keys(knownTabKeys)) {
    if (!currentTabIds.has(tabId)) staleTabIds.add(tabId);
  }

  for (const tabId of Object.keys(knownFingerprints)) {
    if (!currentTabIds.has(tabId)) staleTabIds.add(tabId);
  }

  const tabIds = [...staleTabIds]
    .map((tabId) => Number(tabId))
    .filter((tabId) => Number.isInteger(tabId));

  return {
    tabIds,
    tabKeys: [...new Set([...staleTabIds].map((tabId) => knownTabKeys[tabId]).filter(isNonEmptyString))],
    fingerprints: [
      ...new Set([...staleTabIds].map((tabId) => knownFingerprints[tabId]).filter(isNonEmptyString)),
    ],
  };
}

function readSyncState(payload: unknown): SyncStatePayload {
  if (!isRecord(payload)) return { tabs: [], groups: [] };

  return {
    tabs: readSyncedTabs(payload.tabs),
    groups: readSyncedGroups(payload.groups),
  };
}

function readReplyState(payload: unknown): SyncStatePayload {
  if (isRecord(payload) && isRecord(payload.state)) return readSyncState(payload.state);
  return readSyncState(payload);
}

function readOrganizationRunResponse(payload: unknown): OrganizationRunResponse {
  if (!isRecord(payload)) throw new Error('O backend retornou uma resposta inválida.');

  return {
    tabsAnalyzed: readNumber(payload.tabsAnalyzed),
    model: typeof payload.model === 'string' ? payload.model : '',
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString(),
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
    appliedGroups: readNumber(payload.appliedGroups),
    groupedTabs: readNumber(payload.groupedTabs),
    ungroupedTabs: readNumber(payload.ungroupedTabs),
    skippedTabs: readNumber(payload.skippedTabs),
  };
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readSyncUpsert(payload: unknown): SyncUpsertPayload | null {
  if (!isRecord(payload)) return null;
  const state = readSyncState(payload);
  return {
    ...state,
    originClientId: typeof payload.originClientId === 'string' ? payload.originClientId : undefined,
  };
}

function readSyncDelete(payload: unknown): SyncDeletePayload | null {
  if (!isRecord(payload)) return null;
  const tabKeys = Array.isArray(payload.tabKeys)
    ? payload.tabKeys.filter((tabKey): tabKey is string => typeof tabKey === 'string')
    : [];
  const fingerprints = Array.isArray(payload.fingerprints)
    ? payload.fingerprints.filter((fingerprint): fingerprint is string => typeof fingerprint === 'string')
    : [];

  if (tabKeys.length === 0 && fingerprints.length === 0) return null;

  return {
    originClientId: typeof payload.originClientId === 'string' ? payload.originClientId : undefined,
    tabKeys,
    fingerprints,
    deletedCount: typeof payload.deletedCount === 'number' ? payload.deletedCount : undefined,
  };
}

function readSyncedTabs(value: unknown): SyncedTabPayload[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((tab) => {
      if (!isRecord(tab)) return null;
      if (typeof tab.fingerprint !== 'string' || typeof tab.url !== 'string') return null;

      return {
        tabKey: typeof tab.tabKey === 'string' ? tab.tabKey : tab.fingerprint,
        fingerprint: tab.fingerprint,
        url: tab.url,
        title: typeof tab.title === 'string' ? tab.title : 'Untitled tab',
        position: isInteger(tab.position) ? tab.position : 0,
        groupKey: typeof tab.groupKey === 'string' ? tab.groupKey : null,
      };
    })
    .filter((tab): tab is SyncedTabPayload => tab !== null);
}

function readSyncedGroups(value: unknown): SyncedTabGroupPayload[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((group) => {
      if (!isRecord(group)) return null;
      if (typeof group.groupKey !== 'string') return null;

      return {
        groupKey: group.groupKey,
        title: normalizeGroupTitle(typeof group.title === 'string' ? group.title : ''),
        color: normalizeGroupColor(group.color),
        position: isInteger(group.position) ? group.position : 0,
      };
    })
    .filter((group): group is SyncedTabGroupPayload => group !== null);
}

async function moveTabsIntoRemoteOrder(
  remoteTabs: SyncedTabPayload[],
  tabByTabKey: Map<string, LocalSyncTab>,
): Promise<void> {
  for (const remoteTab of [...remoteTabs].sort((a, b) => a.position - b.position)) {
    const localTab = tabByTabKey.get(remoteTab.tabKey);
    if (!localTab) continue;

    await browser.tabs.move(localTab.tabId, { index: remoteTab.position }).catch(() => undefined);
  }
}

async function removeTabIds(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;

  if (tabIds.length === 1) {
    await browser.tabs.remove(tabIds[0]).catch(() => undefined);
  } else {
    await browser.tabs.remove(tabIds).catch(() => undefined);
  }
}

async function applyRemoteGroups(
  remoteState: SyncStatePayload,
  tabByTabKey: Map<string, LocalSyncTab>,
): Promise<void> {
  if (!browser.tabGroups || typeof browser.tabs.group !== 'function') return;

  const groupByKey = new Map(remoteState.groups.map((group) => [group.groupKey, group]));
  const groupedTabIds = new Map<string, number[]>();
  const ungroupedTabIds: number[] = [];

  for (const remoteTab of remoteState.tabs) {
    const localTab = tabByTabKey.get(remoteTab.tabKey);
    if (!localTab) continue;

    if (remoteTab.groupKey && groupByKey.has(remoteTab.groupKey)) {
      const tabIds = groupedTabIds.get(remoteTab.groupKey) ?? [];
      tabIds.push(localTab.tabId);
      groupedTabIds.set(remoteTab.groupKey, tabIds);
    } else if (localTab.groupId !== TAB_GROUP_ID_NONE) {
      ungroupedTabIds.push(localTab.tabId);
    }
  }

  if (ungroupedTabIds.length > 0 && typeof browser.tabs.ungroup === 'function') {
    await browser.tabs.ungroup(toTabsApiTabIds(ungroupedTabIds)).catch(() => undefined);
  }

  for (const [groupKey, tabIds] of groupedTabIds.entries()) {
    const group = groupByKey.get(groupKey);
    if (!group || tabIds.length === 0) continue;

    const groupId = await (browser.tabs.group({
      tabIds: toTabsApiTabIds(tabIds),
    }) as unknown as Promise<number>);

    await browser.tabGroups.update(groupId, {
      title: group.title,
      color: group.color,
    });

    const groupMaps = await getGroupMaps();
    groupMaps.byLocalGroupId[String(groupId)] = groupKey;
    await saveGroupMaps(groupMaps);
  }
}

async function getSyncTargetWindowId(localTabs: LocalSyncTab[]): Promise<number | undefined> {
  const storedWindowId = await getSavedSyncWindowId();
  if (isInteger(storedWindowId) && (await isNormalWindow(storedWindowId))) return storedWindowId;

  const localWindowId = localTabs[0]?.windowId;
  if (isInteger(localWindowId)) {
    await saveSyncWindowId(localWindowId);
    return localWindowId;
  }

  const lastFocusedWindowId = await getLastFocusedNormalWindowId().catch(() => undefined);
  if (isInteger(lastFocusedWindowId)) {
    await saveSyncWindowId(lastFocusedWindowId);
    return lastFocusedWindowId;
  }

  return undefined;
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
    throw new Error('Abra uma janela normal do navegador antes de sincronizar abas.');
  }

  return activeTab.windowId;
}

async function getNormalWindowsWithTabs(): Promise<Array<Browser.windows.Window & { tabs?: Browser.tabs.Tab[] }>> {
  const windows = (await browser.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  })) as Array<Browser.windows.Window & { tabs?: Browser.tabs.Tab[] }>;

  return windows
    .filter((window) => window.type === 'normal')
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

async function getSavedSyncWindowId(): Promise<number | undefined> {
  const stored = await browser.storage.local.get(SYNC_WINDOW_ID_KEY);
  return isInteger(stored[SYNC_WINDOW_ID_KEY]) ? stored[SYNC_WINDOW_ID_KEY] : undefined;
}

async function saveSyncWindowId(windowId: number): Promise<void> {
  await browser.storage.local.set({ [SYNC_WINDOW_ID_KEY]: windowId });
}

async function isNormalWindow(windowId: number): Promise<boolean> {
  try {
    const window = await browser.windows.get(windowId);
    return window.type === 'normal';
  } catch {
    return false;
  }
}

async function getOrCreateClientId(): Promise<string> {
  const stored = await browser.storage.local.get(SYNC_CLIENT_ID_KEY);
  const existingClientId = stored[SYNC_CLIENT_ID_KEY];
  if (typeof existingClientId === 'string' && existingClientId.trim()) return existingClientId;

  const newClientId = globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random()}`;
  await browser.storage.local.set({ [SYNC_CLIENT_ID_KEY]: newClientId });
  return newClientId;
}

function createTabKey(): string {
  return `tab:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

async function getClientLabel(): Promise<string> {
  if (typeof browser.runtime.getPlatformInfo !== 'function') return 'Tabs Tabs Tabs';

  const platformInfo = await browser.runtime.getPlatformInfo().catch(() => null);
  return platformInfo?.os ? `Tabs Tabs Tabs ${platformInfo.os}` : 'Tabs Tabs Tabs';
}

function getSyncSocketUrl(): string {
  const envUrl = import.meta.env.WXT_SYNC_SOCKET_URL;
  return typeof envUrl === 'string' && envUrl.trim() ? envUrl.trim() : DEFAULT_SYNC_SOCKET_URL;
}

async function getOrCreateGroupKey(
  groupMaps: StoredGroupMaps,
  groupId: number,
  title: string,
  color: TabGroupColor,
  position: number,
): Promise<string> {
  const storageKey = String(groupId);
  const existingGroupKey = groupMaps.byLocalGroupId[storageKey];
  if (existingGroupKey) return existingGroupKey;

  const groupKey = `group:${await fingerprintForValue(`${title}:${color}:${position}`)}`;
  groupMaps.byLocalGroupId[storageKey] = groupKey;
  return groupKey;
}

async function getTabGroup(groupId: number): Promise<Browser.tabGroups.TabGroup | null> {
  if (!browser.tabGroups?.get) return null;

  try {
    return await browser.tabGroups.get(groupId);
  } catch {
    return null;
  }
}

async function getKnownTabFingerprints(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(SYNC_TAB_MAP_KEY);
  return isStringRecord(stored[SYNC_TAB_MAP_KEY]) ? stored[SYNC_TAB_MAP_KEY] : {};
}

async function getKnownTabKeys(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(SYNC_TAB_KEY_MAP_KEY);
  return isStringRecord(stored[SYNC_TAB_KEY_MAP_KEY]) ? stored[SYNC_TAB_KEY_MAP_KEY] : {};
}

async function getSyncedCreatedTabIds(): Promise<Set<number>> {
  const stored = await browser.storage.local.get(SYNC_CREATED_TAB_IDS_KEY);
  const value = stored[SYNC_CREATED_TAB_IDS_KEY];

  if (!Array.isArray(value)) return new Set();

  return new Set(value.filter(isInteger));
}

async function saveSyncedCreatedTabIds(tabIds: Set<number>): Promise<void> {
  await browser.storage.local.set({ [SYNC_CREATED_TAB_IDS_KEY]: [...tabIds] });
}

async function saveKnownTabFingerprints(tabs: Array<Pick<LocalSyncTab, 'tabId' | 'fingerprint'>>): Promise<void> {
  const map = await getKnownTabFingerprints();
  for (const tab of tabs) {
    map[String(tab.tabId)] = tab.fingerprint;
  }
  await browser.storage.local.set({ [SYNC_TAB_MAP_KEY]: map });
}

async function saveKnownTabKeys(tabs: Array<Pick<LocalSyncTab, 'tabId' | 'tabKey'>>): Promise<void> {
  const map = await getKnownTabKeys();
  for (const tab of tabs) {
    map[String(tab.tabId)] = tab.tabKey;
  }
  await browser.storage.local.set({ [SYNC_TAB_KEY_MAP_KEY]: map });
}

async function deleteKnownTabFingerprints(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;

  const map = await getKnownTabFingerprints();
  for (const tabId of tabIds) {
    delete map[String(tabId)];
  }
  await browser.storage.local.set({ [SYNC_TAB_MAP_KEY]: map });
}

async function deleteKnownTabKeys(tabIds: number[]): Promise<void> {
  if (tabIds.length === 0) return;

  const map = await getKnownTabKeys();
  for (const tabId of tabIds) {
    delete map[String(tabId)];
  }
  await browser.storage.local.set({ [SYNC_TAB_KEY_MAP_KEY]: map });
}

async function getGroupMaps(): Promise<StoredGroupMaps> {
  const stored = await browser.storage.local.get(SYNC_GROUP_MAP_KEY);
  const value = stored[SYNC_GROUP_MAP_KEY];

  if (isRecord(value) && isStringRecord(value.byLocalGroupId)) {
    return { byLocalGroupId: value.byLocalGroupId };
  }

  return { byLocalGroupId: {} };
}

async function saveGroupMaps(groupMaps: StoredGroupMaps): Promise<void> {
  await browser.storage.local.set({ [SYNC_GROUP_MAP_KEY]: groupMaps });
}

function stripLocalTabFields(tab: LocalSyncTab): SyncedTabPayload {
  return {
    tabKey: tab.tabKey,
    fingerprint: tab.fingerprint,
    url: tab.url,
    title: tab.title,
    position: tab.position,
    groupKey: tab.groupKey,
  };
}

function normalizeTabTitle(title: string | undefined): string {
  const normalizedTitle = title?.replace(/\s+/g, ' ').trim();
  return normalizedTitle || 'Untitled tab';
}

function normalizeGroupTitle(title: string | undefined): string {
  const normalizedTitle = title?.replace(/\s+/g, ' ').trim();
  return (normalizedTitle || 'Group').slice(0, 32);
}

function normalizeGroupColor(color: unknown): TabGroupColor {
  return typeof color === 'string' && TAB_GROUP_COLORS.has(color) ? (color as TabGroupColor) : 'grey';
}

function countPresenceClients(payload: unknown): number {
  if (!isRecord(payload)) return 0;
  return Object.keys(payload).length;
}

function applyPresenceDiff(currentState: Record<string, unknown>, diff: unknown): Record<string, unknown> {
  if (!isRecord(diff)) return currentState;

  const nextState = { ...currentState };
  const joins = isRecord(diff.joins) ? diff.joins : {};
  const leaves = isRecord(diff.leaves) ? diff.leaves : {};

  for (const [clientId, presence] of Object.entries(joins)) {
    nextState[clientId] = presence;
  }

  for (const clientId of Object.keys(leaves)) {
    delete nextState[clientId];
  }

  return nextState;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
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

function pushWithReply(activeChannel: Channel, event: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    activeChannel
      .push(event, payload)
      .receive('ok', resolve)
      .receive('error', (response) => {
        reject(new Error(readChannelError(response)));
      })
      .receive('timeout', () => {
        reject(new Error('Timeout ao comunicar com o backend de sync.'));
      });
  });
}

function readChannelError(response: unknown): string {
  if (isRecord(response) && typeof response.reason === 'string') return response.reason;
  return 'O backend recusou a operação de sync.';
}

type MaybeTabGroupsApi = {
  onCreated?: { addListener(listener: () => void): void };
  onUpdated?: { addListener(listener: () => void): void };
  onMoved?: { addListener(listener: () => void): void };
  onRemoved?: { addListener(listener: () => void): void };
};
