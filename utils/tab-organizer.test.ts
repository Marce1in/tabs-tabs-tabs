import { describe, expect, it } from 'vitest';

import {
  normalizeOrganizationPlan,
  sanitizeUrlForAi,
  toSanitizedTab,
} from './tab-organizer';

describe('sanitizeUrlForAi', () => {
  it('removes query strings, hashes, and credentials', () => {
    expect(sanitizeUrlForAi('https://user:pass@example.com/path?token=secret#section')).toBe(
      'https://example.com/path',
    );
  });

  it('returns unknown for invalid urls', () => {
    expect(sanitizeUrlForAi('not a url')).toBe('unknown');
  });
});

describe('toSanitizedTab', () => {
  it('drops pinned tabs', () => {
    expect(
      toSanitizedTab({
        id: 1,
        windowId: 1,
        index: 0,
        pinned: true,
        title: 'Pinned',
        url: 'https://example.com',
      }),
    ).toBeNull();
  });

  it('keeps only safe tab fields', () => {
    expect(
      toSanitizedTab({
        id: 2,
        windowId: 4,
        index: 1,
        title: '  Docs   Page ',
        url: 'https://www.example.com/docs?private=yes',
      }),
    ).toEqual({
      id: 2,
      windowId: 4,
      index: 1,
      title: 'Docs Page',
      url: 'https://www.example.com/docs',
      domain: 'example.com',
    });
  });
});

describe('normalizeOrganizationPlan', () => {
  it('drops unknown and duplicate tab ids', () => {
    const result = normalizeOrganizationPlan(
      {
        groups: [
          { name: 'Research', color: 'green', tabIds: [1, 2, 99] },
          { name: 'Again', color: 'red', tabIds: [2, 3] },
        ],
        ungroupedTabIds: [3],
      },
      [1, 2, 3, 4],
    );

    expect(result.plan).toEqual({
      groups: [
        { name: 'Research', color: 'green', tabIds: [1, 2] },
        { name: 'Again', color: 'red', tabIds: [3] },
      ],
      ungroupedTabIds: [4],
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('assigns a fallback color and accounts for every valid tab', () => {
    const result = normalizeOrganizationPlan(
      {
        groups: [{ name: 'Work', color: 'black', tabIds: [10] }],
        ungroupedTabIds: [],
      },
      [10, 11],
    );

    expect(result.plan.groups[0]).toEqual({
      name: 'Work',
      color: 'grey',
      tabIds: [10],
    });
    expect(result.plan.ungroupedTabIds).toEqual([11]);
  });
});
