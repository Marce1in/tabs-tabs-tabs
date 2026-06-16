import type { OpenRouterSettings } from './settings';
import {
  ORGANIZATION_RESPONSE_SCHEMA,
  normalizeOrganizationPlan,
  type NormalizedPlanResult,
  type SanitizedTab,
} from './tab-organizer';

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface RequestOrganizationPlanOptions {
  settings: OpenRouterSettings;
  tabs: SanitizedTab[];
}

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
  };
}

export async function requestOrganizationPlan({
  settings,
  tabs,
}: RequestOrganizationPlanOptions): Promise<NormalizedPlanResult> {
  if (!settings.apiKey) {
    throw new Error('Adicione sua chave da API do OpenRouter antes de organizar as abas.');
  }

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
      'X-OpenRouter-Title': 'Tabs Tabs Tabs',
    },
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      temperature: 0.2,
      max_tokens: 1800,
      provider: {
        require_parameters: true,
      },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'tab_organization',
          strict: true,
          schema: ORGANIZATION_RESPONSE_SCHEMA,
        },
      },
      messages: [
        {
          role: 'system',
          content: [
            'Você organiza abas do navegador em grupos úteis do Chrome.',
            'Retorne apenas JSON que corresponda ao schema fornecido.',
            'Cada id de aba deve aparecer exatamente uma vez, dentro de um grupo ou em ungroupedTabIds.',
            'Não invente ids de abas. Use nomes de grupos com no máximo 2 palavras. Evite grupos com uma única aba, exceto quando a aba for claramente distinta.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              tabs: tabs.map(({ id, index, title, domain, url }) => ({
                id,
                index,
                title,
                domain,
                url,
              })),
            },
            null,
            2,
          ),
        },
      ],
    }),
  });

  const payload = await readOpenRouterPayload(response);
  if (!response.ok) {
    throw new Error(getOpenRouterError(payload, response.status));
  }

  const content = payload.choices?.[0]?.message?.content;
  const json = parseModelContent(content);
  const normalizedPlan = normalizeOrganizationPlan(
    json,
    tabs.map((tab) => tab.id),
  );

  if (normalizedPlan.plan.groups.length === 0) {
    throw new Error('O OpenRouter não retornou grupos de abas utilizáveis. Tente gerar novamente.');
  }

  return normalizedPlan;
}

async function readOpenRouterPayload(response: Response): Promise<OpenRouterChatResponse> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as OpenRouterChatResponse;
  } catch {
    return {
      error: {
        message: text,
      },
    };
  }
}

function parseModelContent(content: unknown): unknown {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content);
    } catch {
      throw new Error('O OpenRouter retornou um texto que não era JSON válido.');
    }
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
    return parseModelContent(text);
  }

  if (isRecord(content)) {
    return content;
  }

  throw new Error('A resposta do OpenRouter não incluiu conteúdo do modelo.');
}

function getOpenRouterError(payload: OpenRouterChatResponse, status: number): string {
  return payload.error?.message || `A requisição ao OpenRouter falhou com status ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
