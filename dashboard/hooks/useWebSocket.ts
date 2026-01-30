'use client';

import { useEffect, useRef } from 'react';
import { websocketService } from '@/lib/websocketService';

type MessageHandler = (data: { type: string; data: unknown }) => void;

/**
 * Hook для подписки на WebSocket сообщения
 * Использует singleton сервис — одно соединение на всё приложение
 */
export function useWebSocket(onMessage: MessageHandler) {
  const onMessageRef = useRef(onMessage);

  // Обновляем ref при изменении callback
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    // Подписываемся на сообщения
    const unsubscribe = websocketService.subscribe((data) => {
      onMessageRef.current(data);
    });

    // Отписываемся при размонтировании
    return unsubscribe;
  }, []);
}

/**
 * Отправка сообщения через WebSocket
 */
export function sendWebSocketMessage(data: unknown): void {
  websocketService.send(data);
}
