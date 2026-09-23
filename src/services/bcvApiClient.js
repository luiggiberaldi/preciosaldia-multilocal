/**
 * BcvApiClient — Cliente seguro y robusto para interactuar con APIs de tasas de cambio BCV.
 * Cuenta con control de timeout integrado por AbortController y sanitización de formato.
 */
export class BcvApiClient {
  constructor(apiUrl, timeoutMs = 10000) {
    this.apiUrl = apiUrl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Obtiene la tasa de cambio directamente como número limpio.
   * Lanza un error si la API retorna ok=false o un valor corrupto.
   * @returns {Promise<number>}
   */
  async getRate() {
    const data = await this.getRaw();

    if (!data.ok) {
      throw new Error(data.error || "BCV API returned ok=false");
    }

    if (typeof data.tasa !== "number" || Number.isNaN(data.tasa)) {
      throw new Error("BCV API returned invalid tasa");
    }

    return data.tasa;
  }

  /**
   * Obtiene la respuesta cruda de la API sanitizada y tipada.
   * Maneja errores internos de fetch y cancela por timeout.
   * @returns {Promise<{ok: boolean, tasa?: number, error?: string, code?: string, fecha?: string, source?: string, timestamp?: string, stale?: boolean}>}
   */
  async getRaw() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(this.apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (typeof data !== "object" || data === null || typeof data.ok !== "boolean") {
        throw new Error("Invalid BCV API response shape");
      }

      if (data.ok === true) {
        return {
          ok: true,
          tasa: Number(data.tasa),
          fecha: data.fecha,
          source: data.source,
          timestamp: data.timestamp,
          stale: data.stale,
        };
      }

      return {
        ok: false,
        error: String(data.error || "Unknown BCV API error"),
        code: typeof data.code === "string" ? data.code : undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown fetch error",
        code: "FETCH_ERROR",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
