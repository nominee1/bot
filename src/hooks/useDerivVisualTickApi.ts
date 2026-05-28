import { useEffect, useRef, useState } from 'react';
import {
  buildDerivTickWsUrl,
  createDerivRawTickClient,
  disposeDerivRawTickClient,
  type DerivRawTickClient,
} from '@/utils/derivRawTickSocket';

const RECONNECT_MS = 2_000;

/**
 * Lightweight raw WebSocket for tick/candle visualization only (Iframe-style).
 * Does not use `api_base`, does not authorize, and is not tied to the trading socket lifecycle.
 */
export function useDerivVisualTickApi() {
  const [visualTickApi, setVisualTickApi] = useState<DerivRawTickClient | null>(null);
  const [visualTickReady, setVisualTickReady] = useState(false);
  const visualTickApiRef = useRef<DerivRawTickClient | null>(null);

  useEffect(() => {
    visualTickApiRef.current = visualTickApi;
  }, [visualTickApi]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let client: DerivRawTickClient | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      clearReconnect();

      setVisualTickReady(false);
      setVisualTickApi(null);
      visualTickApiRef.current = null;

      socket = new WebSocket(buildDerivTickWsUrl());

      socket.onopen = () => {
        if (disposed || !socket) {
          socket?.close();
          return;
        }
        client = createDerivRawTickClient(socket);
        visualTickApiRef.current = client;
        setVisualTickApi(client);
        setVisualTickReady(true);
      };

      socket.onclose = () => {
        setVisualTickReady(false);
        setVisualTickApi(null);
        visualTickApiRef.current = null;
        client = null;
        socket = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, RECONNECT_MS);
        }
      };

      socket.onerror = () => {
        /* onclose handles reconnect */
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnect();
      const toDispose = client ?? visualTickApiRef.current;
      visualTickApiRef.current = null;
      setVisualTickApi(null);
      setVisualTickReady(false);
      void disposeDerivRawTickClient(toDispose);
      if (socket && socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, []);

  return { visualTickApi, visualTickReady, visualTickApiRef };
}

export type { DerivRawTickClient as DerivVisualTickApi };
