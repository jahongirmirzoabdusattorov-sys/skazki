// Bosh ekranga o'rnatish uchun. Hech narsani keshlamaydi.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",()=>{});
