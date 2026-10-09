const REALTIME_ENDPOINT = "wss://e2e-local.invalid/realtime/v1/websocket";
const REALTIME_PROXY = "ws://127.0.0.1:4173/realtime/v1/websocket";

export function realtimeSocketTransportInitScript() {
  return `
    (() => {
      const endpoint = ${JSON.stringify(REALTIME_ENDPOINT)};
      const proxy = ${JSON.stringify(REALTIME_PROXY)};
      const originalImport = window.__vite__import__;
      if (typeof originalImport !== "function") return;
      window.__vite__import__ = async (...args) => {
        const module = await originalImport(...args);
        if (args[0]?.includes("supabase_supabase-js")) {
          const factory = module.WebSocketFactory;
          const getTransport = factory?.getWebSocketConstructor?.bind(factory);
          if (getTransport && !factory.__e2eRealtimePatched) {
            factory.__e2eRealtimePatched = true;
            factory.getWebSocketConstructor = () => {
              const NativeWebSocket = getTransport();
              return new Proxy(NativeWebSocket, {
                construct(Target, constructorArgs) {
                  const originalUrl = String(constructorArgs[0]);
                  const routedUrl = originalUrl.startsWith(endpoint)
                    ? originalUrl.replace(endpoint, proxy)
                    : originalUrl;
                  return Reflect.construct(
                    Target,
                    [routedUrl, ...constructorArgs.slice(1)],
                    Target,
                  );
                },
              });
            };
          }
        }
        return module;
      };
    })();
  `;
}
