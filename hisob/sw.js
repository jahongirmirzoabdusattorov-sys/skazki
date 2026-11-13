// Ilovani bosh ekranga o'rnatish uchun. Hech narsani keshlamaydi: ma'lumotlar har doim yangi.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
