const REALTIME_ENDPOINT = "wss://e2e-local.invalid/realtime/v1/websocket";
const REALTIME_PROXY = "ws://127.0.0.1:4173/realtime/v1/websocket";

export function mockRealtimeWebSocketInitScript() {
  return `
    (() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, args) {
          const url = String(args[0]);
          const proxiedUrl = url.startsWith(${JSON.stringify(REALTIME_ENDPOINT)})
            ? url.replace(${JSON.stringify(REALTIME_ENDPOINT)}, ${JSON.stringify(REALTIME_PROXY)})
            : url;
          return Reflect.construct(Target, [proxiedUrl, ...args.slice(1)], Target);
        },
      });
    })();
  `;
}
