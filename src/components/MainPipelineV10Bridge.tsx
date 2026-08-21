import { useEffect } from "react";
import { buildV10DiscoveryContext } from "@/lib/innovation-genome-v10";

/**
 * Main ChatApp imports its pipeline relatively inside the immutable package,
 * bypassing workspace seams. This capture bridge injects V10 context at the
 * actual form boundary, then restores visible user text after package handler
 * has captured the augmented value. No package file is edited.
 */
export function MainPipelineV10Bridge() {
  useEffect(() => {
    const bypass = new WeakSet<HTMLFormElement>();

    const findChatForm = (target: EventTarget | null): { form: HTMLFormElement; textarea: HTMLTextAreaElement } | null => {
      const element = target instanceof Element ? target : null;
      const form = (element?.closest("form") ?? null) as HTMLFormElement | null;
      if (!form) return null;
      const button = form.querySelector('button[type="submit"]');
      const label = button?.textContent ?? "";
      if (!/Ground & Answer|Deep Answer/.test(label)) return null;
      const textarea = form.querySelector("textarea") as HTMLTextAreaElement | null;
      return textarea ? { form, textarea } : null;
    };

    const setReactValue = (textarea: HTMLTextAreaElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const augment = (form: HTMLFormElement, textarea: HTMLTextAreaElement, event: Event) => {
      if (bypass.has(form)) {
        bypass.delete(form);
        return;
      }
      const original = textarea.value.trim();
      if (!original || original.includes("## V10 CREATIVE TREE OF LIFE")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const context = buildV10DiscoveryContext(original, "research");
      const augmented = `${original}\n\n${context.directive}`;
      setReactValue(textarea, augmented);
      (window as any)._VERITAS_V10_MAIN_DISCOVERY = context;
      window.dispatchEvent(new CustomEvent("veritas:v10-main-discovery", { detail: context }));
      window.setTimeout(() => {
        bypass.add(form);
        form.requestSubmit();
        // Package submit closure has captured augmented render state; restore UI.
        window.setTimeout(() => setReactValue(textarea, original), 50);
      }, 0);
    };

    const onSubmit = (event: SubmitEvent) => {
      const found = findChatForm(event.target);
      if (found) augment(found.form, found.textarea, event);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      const found = findChatForm(event.target);
      if (found) augment(found.form, found.textarea, event);
    };

    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}