import { getAppId, getSocketURL } from '@/components/shared/utils/config/config';
import { getInitialLanguage } from '@deriv-com/translations';
import { website_name } from '@/utils/site-config';
import {
  forgetAllDerivCandleStreams,
  forgetAllDerivTickStreams,
} from '@/utils/derivTickStream';

const WS_OPEN = 1;
const SEND_TIMEOUT_MS = 45_000;

/** Same surface as DerivAPIBasic used by chart / digit tick effects. */
export type DerivRawTickClient = {
  connection: { readyState: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (req: Record<string, unknown>) => Promise<any>;
  disconnect: () => void;
  onMessage: () => {
    subscribe: (cb: (msg: { data?: unknown }) => void) => { unsubscribe: () => void };
  };
};

export function buildDerivTickWsUrl(): string {
  const cleanedServer = getSocketURL().replace(/[^a-zA-Z0-9.]/g, '');
  const cleanedAppId = String(getAppId() ?? '').replace(/[^a-zA-Z0-9]/g, '');
  return `wss://${cleanedServer}/websockets/v3?app_id=${cleanedAppId}&l=${getInitialLanguage()}&brand=${website_name.toLowerCase()}`;
}

export function createDerivRawTickClient(socket: WebSocket): DerivRawTickClient {
  const listeners = new Set<(msg: { data?: unknown }) => void>();
  const pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let nextReqId = 1;

  const flushPending = (err: Error) => {
    pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(err);
    });
    pending.clear();
  };

  const onSocketMessage = (event: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }

    const reqId = data.req_id;
    if (typeof reqId === 'number' && pending.has(reqId)) {
      const entry = pending.get(reqId)!;
      clearTimeout(entry.timer);
      pending.delete(reqId);
      entry.resolve(data);
    }

    listeners.forEach(cb => cb({ data }));
  };

  socket.addEventListener('message', onSocketMessage);

  const send = (req: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      if (socket.readyState !== WS_OPEN) {
        reject(new Error('tick socket not open'));
        return;
      }
      const req_id = nextReqId++;
      const timer = setTimeout(() => {
        if (!pending.has(req_id)) return;
        pending.delete(req_id);
        reject(new Error('tick socket request timeout'));
      }, SEND_TIMEOUT_MS);

      pending.set(req_id, {
        resolve,
        reject,
        timer,
      });

      try {
        socket.send(JSON.stringify({ ...req, req_id }));
      } catch (err) {
        clearTimeout(timer);
        pending.delete(req_id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

  return {
    connection: socket,
    send,
    disconnect: () => {
      socket.removeEventListener('message', onSocketMessage);
      flushPending(new Error('tick socket closed'));
      if (socket.readyState === WS_OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
    onMessage: () => ({
      subscribe: cb => {
        listeners.add(cb);
        return {
          unsubscribe: () => {
            listeners.delete(cb);
          },
        };
      },
    }),
  };
}

export async function disposeDerivRawTickClient(client: DerivRawTickClient | null | undefined) {
  if (!client) return;
  if (client.connection.readyState === WS_OPEN) {
    try {
      await forgetAllDerivTickStreams(client);
      await forgetAllDerivCandleStreams(client);
    } catch {
      /* noop */
    }
  }
  client.disconnect();
}
