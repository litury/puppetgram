'use client';

import ReconnectingWebSocket from 'reconnecting-websocket';
import { WS_URL } from './config';

type MessageHandler = (data: { type: string; data: unknown }) => void;

/**
 * Singleton WebSocket service
 * Одно соединение на всё приложение
 */
class WebSocketService {
  private ws: ReconnectingWebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private isConnecting = false;

  connect(): void {
    if (this.ws || this.isConnecting) return;

    this.isConnecting = true;
    this.ws = new ReconnectingWebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.isConnecting = false;
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.handlers.forEach(handler => handler(parsed));
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);

    // Автоматически подключаемся при первой подписке
    if (!this.ws) {
      this.connect();
    }

    // Возвращаем функцию отписки
    return () => {
      this.handlers.delete(handler);
    };
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}

// Singleton instance
export const websocketService = new WebSocketService();
