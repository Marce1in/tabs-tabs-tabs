import { describe, expect, it } from 'vitest';

import {
  findSyncedDuplicateTabIds,
  findStaleKnownSyncEntries,
  fingerprintForValue,
  normalizeSyncUrl,
  planRemoteStateApplication,
  shouldIgnoreLocalEvent,
  type SyncedTabPayload,
} from './tab-sync';

describe('normalizeSyncUrl', () => {
  it('keeps path query and hash while stripping credentials', () => {
    expect(normalizeSyncUrl('https://user:pass@Example.com/docs?token=abc#part')).toBe(
      'https://example.com/docs?token=abc#part',
    );
  });

  it('rejects urls browsers cannot mirror as normal tabs', () => {
    expect(normalizeSyncUrl('chrome://extensions')).toBeNull();
    expect(normalizeSyncUrl('file:///tmp/report.html')).toBeNull();
    expect(normalizeSyncUrl('not a url')).toBeNull();
  });
});

describe('fingerprintForValue', () => {
  it('generates a stable sha256 hex fingerprint', async () => {
    await expect(fingerprintForValue('https://example.com/')).resolves.toBe(
      '0f115db062b7c0dd030b16878c99dea5c354b49dc37b38eb8846179c7783e9d7',
    );
  });
});

describe('planRemoteStateApplication', () => {
  it('opens missing remote tabs without closing local-only tabs', () => {
    const remoteTabs: SyncedTabPayload[] = [
      { tabKey: 'tab-a', fingerprint: 'a', url: 'https://a.test/', title: 'A', position: 0, groupKey: null },
      { tabKey: 'tab-b', fingerprint: 'b', url: 'https://b.test/', title: 'B', position: 1, groupKey: null },
    ];

    expect(
      planRemoteStateApplication(
        [
          { tabId: 1, tabKey: 'tab-a', fingerprint: 'a', url: 'https://a.test/' },
          { tabId: 2, tabKey: 'local-only', fingerprint: 'local-only', url: 'https://local.test/' },
        ],
        remoteTabs,
      ),
    ).toEqual({
      openTabs: [{ tabKey: 'tab-b', fingerprint: 'b', url: 'https://b.test/', title: 'B', position: 1, groupKey: null }],
      updateTabs: [],
      reuseTabs: [],
      existingTabKeys: ['tab-a'],
    });
  });

  it('does not open a remote tab that already exists in another local window', () => {
    const remoteTabs: SyncedTabPayload[] = [
      { tabKey: 'remote-tab', fingerprint: 'shared', url: 'https://shared.test/', title: 'Shared', position: 0, groupKey: null },
    ];

    expect(
      planRemoteStateApplication(
        [
          { tabId: 1, tabKey: 'other-window', fingerprint: 'other-window', url: 'https://other.test/' },
          { tabId: 2, tabKey: 'local-shared', fingerprint: 'shared', url: 'https://shared.test/' },
        ],
        remoteTabs,
      ),
    ).toEqual({
      openTabs: [],
      updateTabs: [],
      reuseTabs: [{ tabId: 2, tab: remoteTabs[0] }],
      existingTabKeys: ['remote-tab'],
    });
  });

  it('updates an existing tab when the same tab key navigates to a new url', () => {
    const remoteTabs: SyncedTabPayload[] = [
      { tabKey: 'same-tab', fingerprint: 'new', url: 'https://new.test/', title: 'New', position: 0, groupKey: null },
    ];

    expect(
      planRemoteStateApplication(
        [{ tabId: 10, tabKey: 'same-tab', fingerprint: 'old', url: 'https://old.test/' }],
        remoteTabs,
      ),
    ).toEqual({
      openTabs: [],
      updateTabs: [{ tabId: 10, tab: remoteTabs[0] }],
      reuseTabs: [],
      existingTabKeys: ['same-tab'],
    });
  });
});

describe('shouldIgnoreLocalEvent', () => {
  it('ignores events while applying remote state or inside the cooldown window', () => {
    expect(shouldIgnoreLocalEvent(true, 0, 100)).toBe(true);
    expect(shouldIgnoreLocalEvent(false, 200, 100)).toBe(true);
    expect(shouldIgnoreLocalEvent(false, 100, 200)).toBe(false);
  });
});

describe('findSyncedDuplicateTabIds', () => {
  it('closes synced duplicates while preserving a manual tab for the same fingerprint', () => {
    expect(
      findSyncedDuplicateTabIds(
        [
          { tabId: 1, tabKey: 'same' },
          { tabId: 2, tabKey: 'same' },
          { tabId: 3, tabKey: 'other' },
        ],
        new Set([2]),
      ),
    ).toEqual([2]);
  });

  it('keeps one synced tab when all duplicates were created by sync', () => {
    expect(
      findSyncedDuplicateTabIds(
        [
          { tabId: 1, tabKey: 'same' },
          { tabId: 2, tabKey: 'same' },
          { tabId: 3, tabKey: 'same' },
        ],
        new Set([1, 2, 3]),
      ),
    ).toEqual([2, 3]);
  });
});

describe('findStaleKnownSyncEntries', () => {
  it('returns known tabs that are no longer in the syncable local state', () => {
    expect(
      findStaleKnownSyncEntries(
        [{ tabId: 1 }, { tabId: 3 }],
        {
          '1': 'tab-a',
          '2': 'tab-b',
          '4': 'tab-d',
        },
        {
          '1': 'fingerprint-a',
          '2': 'fingerprint-b',
          '3': 'fingerprint-c',
        },
      ),
    ).toEqual({
      tabIds: [2, 4],
      tabKeys: ['tab-b', 'tab-d'],
      fingerprints: ['fingerprint-b'],
    });
  });
});
