export const TAB_GROUP_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;

const TAB_GROUP_COLOR_SET = new Set<string>(TAB_GROUP_COLORS);
const MAX_GROUPS = 12;
const MAX_GROUP_NAME_LENGTH = 32;

export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

export interface BrowserTabLike {
  id?: number;
  windowId?: number;
  index?: number;
  title?: string;
  url?: string;
  pendingUrl?: string;
  pinned?: boolean;
}

export interface SanitizedTab {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  domain: string;
}

export interface OrganizationGroup {
  name: string;
  color: TabGroupColor;
  tabIds: number[];
}

export interface OrganizationPlan {
  groups: OrganizationGroup[];
  ungroupedTabIds: number[];
}

export interface NormalizedPlanResult {
  plan: OrganizationPlan;
  warnings: string[];
}

export const ORGANIZATION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    groups: {
      type: 'array',
      maxItems: MAX_GROUPS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: 'Nome curto do grupo de abas. Use no máximo 2 palavras e abaixo de 32 caracteres.',
          },
          color: {
            type: 'string',
            enum: TAB_GROUP_COLORS,
            description: 'Cor do grupo de abas do Chrome.',
          },
          tabIds: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'integer',
              description: 'Um id de aba da lista de abas fornecida.',
            },
          },
        },
        required: ['name', 'color', 'tabIds'],
      },
    },
    ungroupedTabIds: {
      type: 'array',
      items: {
        type: 'integer',
        description: 'Ids de abas que devem permanecer fora de grupos.',
      },
    },
  },
  required: ['groups', 'ungroupedTabIds'],
} as const;

export function toSanitizedTab(tab: BrowserTabLike): SanitizedTab | null {
  if (tab.pinned) return null;
  const { id, windowId, index } = tab;

  if (!isInteger(id) || !isInteger(windowId) || !isInteger(index)) {
    return null;
  }

  const rawUrl = tab.url ?? tab.pendingUrl ?? '';
  const title = normalizeTitle(tab.title);

  return {
    id,
    windowId,
    index,
    title,
    url: sanitizeUrlForAi(rawUrl),
    domain: getDomainLabel(rawUrl),
  };
}

export function sanitizeUrlForAi(rawUrl: string): string {
  if (!rawUrl.trim()) return 'unknown';

  try {
    const parsedUrl = new URL(rawUrl);
    parsedUrl.username = '';
    parsedUrl.password = '';
    parsedUrl.search = '';
    parsedUrl.hash = '';
    return parsedUrl.toString();
  } catch {
    return 'unknown';
  }
}

export function getDomainLabel(rawUrl: string): string {
  if (!rawUrl.trim()) return 'unknown';

  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = parsedUrl.hostname.replace(/^www\./i, '');
    if (hostname) return hostname;
    return parsedUrl.protocol.replace(':', '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function normalizeOrganizationPlan(
  input: unknown,
  validTabIds: Iterable<number>,
): NormalizedPlanResult {
  const validIds = new Set(validTabIds);
  const warnings: string[] = [];

  if (!isRecord(input)) {
    throw new Error('A resposta da IA não era um objeto JSON.');
  }

  if (!Array.isArray(input.groups)) {
    throw new Error('A resposta da IA não incluiu uma lista de grupos.');
  }

  const groupedIds = new Set<number>();
  const accountedIds = new Set<number>();
  const groups: OrganizationGroup[] = [];

  for (const [groupIndex, groupValue] of input.groups.slice(0, MAX_GROUPS).entries()) {
    if (!isRecord(groupValue)) {
      warnings.push(`Grupo malformado ignorado no índice ${groupIndex}.`);
      continue;
    }

    if (!Array.isArray(groupValue.tabIds)) {
      warnings.push(`Grupo ${groupIndex + 1} ignorado porque tabIds não era uma lista.`);
      continue;
    }

    const tabIds = readUniqueValidTabIds(groupValue.tabIds, validIds, groupedIds, warnings);
    if (tabIds.length === 0) {
      warnings.push(`Grupo ${groupIndex + 1} ignorado porque não tinha abas válidas.`);
      continue;
    }

    const name = normalizeGroupName(groupValue.name, `Grupo ${groups.length + 1}`);
    const color = isTabGroupColor(groupValue.color)
      ? groupValue.color
      : TAB_GROUP_COLORS[groupIndex % TAB_GROUP_COLORS.length];

    if (!isTabGroupColor(groupValue.color)) {
      warnings.push(`O grupo "${name}" usou uma cor inválida e recebeu ${color}.`);
    }

    tabIds.forEach((tabId) => {
      groupedIds.add(tabId);
      accountedIds.add(tabId);
    });

    groups.push({ name, color, tabIds });
  }

  const ungroupedTabIds: number[] = [];
  const rawUngroupedIds = Array.isArray(input.ungroupedTabIds) ? input.ungroupedTabIds : [];
  for (const rawTabId of rawUngroupedIds) {
    if (!Number.isInteger(rawTabId)) continue;
    if (!validIds.has(rawTabId)) continue;
    if (accountedIds.has(rawTabId)) continue;
    accountedIds.add(rawTabId);
    ungroupedTabIds.push(rawTabId);
  }

  for (const tabId of validIds) {
    if (!accountedIds.has(tabId)) {
      accountedIds.add(tabId);
      ungroupedTabIds.push(tabId);
    }
  }

  return {
    plan: {
      groups,
      ungroupedTabIds,
    },
    warnings,
  };
}

export function countGroupedTabs(plan: OrganizationPlan): number {
  return plan.groups.reduce((total, group) => total + group.tabIds.length, 0);
}

export function buildTabMap(tabs: SanitizedTab[]): Map<number, SanitizedTab> {
  return new Map(tabs.map((tab) => [tab.id, tab]));
}

function normalizeTitle(title: string | undefined): string {
  const normalizedTitle = title?.replace(/\s+/g, ' ').trim();
  return normalizedTitle || 'Untitled tab';
}

function normalizeGroupName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, MAX_GROUP_NAME_LENGTH) || fallback;
}

function readUniqueValidTabIds(
  rawTabIds: unknown[],
  validIds: Set<number>,
  seenIds: Set<number>,
  warnings: string[],
): number[] {
  const tabIds: number[] = [];

  for (const rawTabId of rawTabIds) {
    if (!isInteger(rawTabId)) {
      warnings.push('Um id de aba não inteiro foi ignorado.');
      continue;
    }

    if (!validIds.has(rawTabId)) {
      warnings.push(`Id de aba desconhecido ignorado: ${rawTabId}.`);
      continue;
    }

    if (seenIds.has(rawTabId) || tabIds.includes(rawTabId)) {
      warnings.push(`Id de aba duplicado ignorado: ${rawTabId}.`);
      continue;
    }

    tabIds.push(rawTabId);
  }

  return tabIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTabGroupColor(value: unknown): value is TabGroupColor {
  return typeof value === 'string' && TAB_GROUP_COLOR_SET.has(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
