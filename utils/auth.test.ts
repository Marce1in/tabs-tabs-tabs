import { describe, expect, it } from 'vitest';

import { parseAuthCallbackUrl } from './auth';

describe('parseAuthCallbackUrl', () => {
  it('reads the backend auth fragment', () => {
    expect(
      parseAuthCallbackUrl(
        'https://extension.test/github#token=token-1&expiresAt=2099-01-01T00%3A00%3A00Z&userId=user-1&login=pablo&name=Pablo&avatarUrl=https%3A%2F%2Favatars.test%2Fpablo.png',
      ),
    ).toEqual({
      token: 'token-1',
      expiresAt: '2099-01-01T00:00:00Z',
      userId: 'user-1',
      login: 'pablo',
      name: 'Pablo',
      avatarUrl: 'https://avatars.test/pablo.png',
    });
  });

  it('rejects error and malformed fragments', () => {
    expect(() => parseAuthCallbackUrl('https://extension.test/github#error=bad_state')).toThrow(
      'Falha ao entrar com GitHub',
    );

    expect(() => parseAuthCallbackUrl('https://extension.test/github#token=missing-fields')).toThrow(
      'resposta de login inválida',
    );
  });
});
