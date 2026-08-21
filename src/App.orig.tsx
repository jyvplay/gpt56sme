import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppStateProvider, useAppState } from '@/lib/app-state';
import { ChatApp } from '@/components/ChatApp';
import { V15Overlay } from '@/components/V15Overlay';
import { GBSDashboard } from '@/components/GBSDashboard';
import { ControlPlanePage } from '@/components/ControlPlanePage';
import { TemplatesPage } from '@/components/TemplatesPage';
import { ModulesPage } from '@/components/ModulesPage';
import { AdaptersPage } from '@/components/AdaptersPage';
import { AdversarialPanel } from '@/components/AdversarialPanel';
import { MemoryInspector } from '@/components/MemoryInspector';
import { ResourceEstimatorPage } from '@/components/ResourceEstimatorPage';

type Page = "chat" | "dashboard" | "estimator" | "templates" | "modules" | "control" | "adapters" | "adversarial" | "memory";

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "dashboard", label: "Dashboard", icon: "📊" },
  { id: "estimator", label: "Estimator", icon: "⚡" },
  { id: "templates", label: "Templates", icon: "📑" },
  { id: "modules", label: "Modules", icon: "🧩" },
  { id: "control", label: "Control", icon: "⚙️" },
  { id: "adapters", label: "Adapters", icon: "⚖️" },
  { id: "adversarial", label: "Adversarial", icon: "⚔️" },
  { id: "memory", label: "Memory", icon: "🧠" },
];

function ScraperEnginesStatusBar() {
  const engines = [
    { id: "vanguard", label: "Vanguard-Titanium" },
    { id: "palisade", label: "Palisade-Adjudicator" },
    { id: "arbiter", label: "Arbiter-Omega" },
    { id: "sibyl", label: "Sibyl-Oracle" },
    { id: "strata", label: "Strata-Engine" },
    { id: "nexus", label: "Nexus-Consensus" },
    { id: "hydra", label: "Hydra-Reader" },
    { id: "vnext", label: "Native-VNext" },
  ];

  const transports = [
    { id: "direct", label: "Direct" },
    { id: "jina", label: "Jina Reader" },
    { id: "proxy", label: "Proxies" },
    { id: "wayback", label: "Wayback" },
    { id: "cache", label: "Cache" },
  ];
  
  const { settings, setSetting } = useAppState();

  // Use the settings to add interactive toggles for experimental features.
  // We explicitly show the Titanium toggle here, enabling the feature directly 
  // via the global app state.
  const titaniumActive = (settings as any)?.enableTitaniumEgress === true;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-1.5 text-xs py-1">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Scraper Engines:</span>
        <div className="flex flex-wrap items-center gap-2">
          {engines.map(eng => {
            const isActive = eng.id !== "vanguard" || titaniumActive;
            return (
              <div key={eng.id} className="flex items-center gap-1 shrink-0">
                <span className={`font-semibold text-[11px] ${isActive ? "text-zinc-600" : "text-zinc-400"}`}>{eng.label}</span>
                {eng.id === "vanguard" ? (
                  <label className="relative inline-flex cursor-pointer items-center ml-1">
                    <input type="checkbox" className="sr-only peer" checked={titaniumActive} onChange={(e) => setSetting("enableTitaniumEgress" as any, e.target.checked)} />
                    <div className="w-6 h-3.5 bg-zinc-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-emerald-500"></div>
                  </label>
                ) : (
                  <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold bg-emerald-100 text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    READY
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5 border-t border-zinc-100/30 pt-1">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Transport Lanes:</span>
        <div className="flex flex-wrap items-center gap-2">
          {transports.map(lan => (
            <div key={lan.id} className="flex items-center gap-1 shrink-0">
              <span className="text-zinc-500 font-medium text-[11px]">{lan.label}</span>
              <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-100">
                <span className="h-1 w-1 bg-blue-500 rounded-full animate-pulse" />
                AVAILABLE
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const [page, setPage] = useState<Page>("chat");
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    let anchor: HTMLElement | null = null;
    const attach = () => {
      const spans = Array.from(document.querySelectorAll("span"));
      const connSpan = spans.find((s) => /Connectors:/i.test(s.textContent || ""));
      if (!connSpan) return;
      
      const rowContainer = connSpan.closest(".border-t");
      if (!rowContainer) return;

      let existing = rowContainer.querySelector<HTMLElement>("[data-scraper-engines-portal]");
      if (!existing) {
        existing = document.createElement("div");
        existing.setAttribute("data-scraper-engines-portal", "1");
        existing.className = "border-t border-zinc-100 bg-zinc-50/90 px-4 py-1.5";
        rowContainer.appendChild(existing);
      }
      setHost(existing);
      anchor = existing;
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (anchor && anchor.parentElement) {
        try { anchor.parentElement.removeChild(anchor); } catch {}
      }
    };
  }, []);

  useEffect(() => () => setHost(null), []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 antialiased font-sans">
      {/* Top global header — 1:1 parity attempt, fixed height, no deformation */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white shadow-sm overflow-hidden">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between gap-4 px-3 sm:px-4">
          {/* Logo + Title block — fixed width items */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-cyan-600 text-base font-black text-white shadow-sm">V</div>
            <div className="hidden shrink-0 leading-tight md:block">
              <h1 className="text-[15px] font-bold tracking-tight text-zinc-900 leading-none">VeritasChat + GBSE</h1>
              <p className="text-[10px] font-medium text-zinc-500 mt-0.5">Shared state · constraints · 126 defenses · 4-stage</p>
            </div>
          </div>

          {/* Navigation Pills — overflow-x-auto handles narrow screens */}
          <nav className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-x-auto scrollbar-none" aria-label="Main Navigation">
            <div className="flex items-center gap-0.5 rounded-full border border-zinc-100 bg-zinc-50/50 p-1">
              {NAV_ITEMS.map((item) => {
                const active = page === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all ${
                      active
                        ? "bg-zinc-900 text-white shadow-sm"
                        : "text-zinc-600 hover:bg-white hover:text-zinc-900 hover:shadow-sm"
                    }`}
                  >
                    <span className="text-[14px] leading-none" aria-hidden="true">{item.icon}</span>
                    <span className="leading-none">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      {/* Main viewport */}
      <main className="mx-auto w-full max-w-[1600px] flex-1">
        {page === "chat" && <ChatApp />}
        {page === "dashboard" && <div className="p-4"><GBSDashboard /></div>}
        {page === "estimator" && <div className="p-4"><ResourceEstimatorPage /></div>}
        {page === "templates" && <div className="p-4"><TemplatesPage /></div>}
        {page === "modules" && <div className="p-4"><ModulesPage /></div>}
        {page === "control" && <div className="p-4"><ControlPlanePage /></div>}
        {page === "adapters" && <div className="p-4"><AdaptersPage /></div>}
        {page === "adversarial" && <div className="p-4"><AdversarialPanel /></div>}
        {page === "memory" && <div className="p-4"><MemoryInspector /></div>}
      </main>

      {/* V15 Pipeline Overlay — Verbatim calibration stack */}
      <V15Overlay />

      {/* Render the portal status bar once host is ready */}
      {host && createPortal(<ScraperEnginesStatusBar />, host)}
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}
