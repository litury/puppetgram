/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
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
