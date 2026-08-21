/** Persistent V15 state override: default ON unless explicitly disabled. */
export * from "./v15-state.base";
import { setV15Enabled as baseSetV15Enabled } from "./v15-state.base";

const K_ENABLED = "veritas.v15.enabled";
const EVT = "veritas:v15:change";

export function getV15Enabled(): boolean {
  try {
    const value = localStorage.getItem(K_ENABLED);
    return value === null ? true : value === "true";
  } catch { return true; }
}

export function setV15Enabled(on: boolean): void { baseSetV15Enabled(on); }

export function subscribeV15(cb: (on: boolean) => void): () => void {
  const handler = () => cb(getV15Enabled());
  window.addEventListener(EVT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVT, handler);
    window.removeEventListener("storage", handler);
  };
}

// [unify.mjs] Emergency mocks for symbols lost from package/wrapper
export function getGeminiKey(): string { return ""; }
