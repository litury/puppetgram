'use client';

import { useEffect, useRef } from 'react';
import ReconnectingWebSocket from 'reconnecting-websocket';

type MessageHandler = (data: { type: string; data: unknown }) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const onMessageRef = useRef(onMessage);

  // Обновляем ref при изменении callback
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';
    wsRef.current = new ReconnectingWebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket disconnected');
    };

    wsRef.current.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessageRef.current(parsed);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    return () => {
      wsRef.current?.close();
    };
  }, []);
}
