declare module 'phoenix' {
  export class Socket {
    constructor(endPoint: string, opts?: { params?: Record<string, unknown> });
    channel(topic: string, chanParams?: Record<string, unknown>): Channel;
    connect(params?: Record<string, unknown>): void;
    disconnect(callback?: () => void, code?: number, reason?: string): void;
    onOpen(callback: () => void): void;
    onError(callback: (error?: unknown) => void): void;
    onClose(callback: (event?: unknown) => void): void;
  }

  export class Channel {
    join(timeout?: number): Push;
    leave(timeout?: number): Push;
    push(event: string, payload?: Record<string, unknown>, timeout?: number): Push;
    on(event: string, callback: (payload: unknown, ref?: string) => void): number;
  }

  export class Push {
    receive(status: string, callback: (response: unknown) => void): Push;
  }
}
