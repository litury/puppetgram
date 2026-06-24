/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Тихое обновление: новый SW не захватывает активную сессию, а ждёт и активируется
  // при следующем полном открытии PWA. Иначе старые подгружаемые чанки → 404
  // («сайт глючит до перезакрытия»). API всё равно NetworkOnly → данные всегда свежие.
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) =>
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/auth/') ||
        url.pathname.startsWith('/ws'),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  disableDevLogs: true,
});

serwist.addEventListeners();
