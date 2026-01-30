/**
 * Dashboard configuration
 * API and WebSocket URLs for connecting to ws-server
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';
