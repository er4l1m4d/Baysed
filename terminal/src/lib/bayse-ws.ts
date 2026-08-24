/**
 * Bayse WebSocket client for the terminal.
 * Connects to wss://socket.bayse.markets/ws/v1/realtime for live BTC prices.
 */

export interface BayseTicker {
  price: number;
  timestamp: number;
}

export type BayseCallback = (ticker: BayseTicker) => void;

export class BayseWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: BayseCallback[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;

  constructor(url = "wss://socket.bayse.markets/ws/v1/realtime") {
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("[Bayse WS] Connected");
      // Subscribe to BTC price feed
      this.ws?.send(
        JSON.stringify({
          type: "subscribe",
          channels: [{ name: "ticker", symbols: ["BTCUSDT"] }],
        })
      );
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ticker" && data.symbol === "BTCUSDT") {
          const ticker: BayseTicker = {
            price: parseFloat(data.price || data.lastPrice || "0"),
            timestamp: Date.now(),
          };
          if (ticker.price > 0) {
            this.callbacks.forEach((cb) => cb(ticker));
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    this.ws.onclose = () => {
      console.log("[Bayse WS] Disconnected, reconnecting in 3s...");
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  subscribe(callback: BayseCallback) {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((cb) => cb !== callback);
    };
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

// Singleton for the app
export const bayseWs = new BayseWebSocket();
