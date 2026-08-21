/**
 * retrieval-control-plane.ts
 * ============================================================================
 * Additive control plane over canonical retrieval-accelerator.ts.
 *
 * Adds policy-aware cache/coalescing, reference-counted cancellation, optional
 * Web Locks, BroadcastChannel congestion notices, lane-origin accounting,
 * delayed hedging, runtime budgets, document discovery, and bounded crawling.
 */

import {
  RetrievalScheduler,
  cachedValue,
  warmupHosts,
  type SchedulerOptions,
} from "./retrieval-accelerator";

export type RobotsMode = "off" | "advisory" | "strict";
export type CacheMode = "off" | "performance";
export type CrawlScope = "seed-origins" | "same-origin";

export interface RetrievalPolicy {
  policyVersion: string;
  extractionVersion: string;
  maxBytes: number;
  freshnessMs: number;
  requiredLaneClasses: number;
  cacheMode: CacheMode;
  robotsMode: RobotsMode;
  scope: CrawlScope;
  allowHostedRenderer: boolean;
  allowPublicRelays: boolean;
  allowArchive: boolean;
}

export const DEFAULT_RETRIEVAL_POLICY: Readonly<RetrievalPolicy> = {
  policyVersion: "rcp-v1",
  extractionVersion: "unknown",
  maxBytes: 2_000_000,
  freshnessMs: 0,
  requiredLaneClasses: 1,
  cacheMode: "off",
  robotsMode: "off",
  scope: "seed-origins",
  allowHostedRenderer: true,
  allowPublicRelays: true,
  allowArchive: true,
};

export type RetrievalFailureKind =
  | "congestion"
  | "access-denied"
  | "challenge"
  | "transient"
  | "permanent"
  | "abort";

export class RetrievalControlError extends Error {
  readonly kind: RetrievalFailureKind;
  readonly retryAfterMs?: number;
  readonly scope: "origin" | "lane";

  constructor(
    kind: RetrievalFailureKind,
    message: string,
    options?: { retryAfterMs?: number; scope?: "origin" | "lane" },
  ) {
    super(message);
    this.name = "RetrievalControlError";
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs;
    this.scope = options?.scope ?? "lane";
  }
}

export interface ScheduleContext {
  attempt: number;
  host: string;
  hostLimit: number;
  signal?: AbortSignal;
}

export interface ControlledExecution<T> {
  value: T;
  source: "network" | "cache";
  policyKey: string;
  needsReattestation: boolean;
}

export interface LaneCandidate<T> {
  id: string;
  laneClass: string;
  admissionUrl: string;
  priority?: number;
  run: (signal: AbortSignal) => Promise<T>;
}

export interface LaneSuccess<T> {
  laneId: string;
  laneClass: string;
  value: T;
  latencyMs: number;
}

export interface LaneFailure {
  laneId: string;
  laneClass: string;
  kind: RetrievalFailureKind;
  message: string;
}

export interface HedgedQuorumResult<T> {
  quorumMet: boolean;
  requiredClasses: number;
  successes: LaneSuccess<T>[];
  failures: LaneFailure[];
  startedLaneIds: string[];
  blockedByOriginPolicy: boolean;
  elapsedMs: number;
}

export interface HedgedQuorumOptions<T> {
  signal?: AbortSignal;
  requiredClasses?: number;
  initialFanout?: number;
  maxStarted?: number;
  defaultHedgeDelayMs?: number;
  minHedgeDelayMs?: number;
  maxHedgeDelayMs?: number;
  quality?: (value: T, lane: LaneCandidate<T>) => boolean;
  onDebug?: (message: string) => void;
}

export type DiscoveredKind = "page" | "sitemap" | "feed";

export interface DiscoveredUrl {
  url: string;
  kind: DiscoveredKind;
  source: "html-link" | "html-feed" | "sitemap" | "sitemap-index" | "rss" | "atom";
  priority: number;
}

export interface RuntimeSignals {
  saveData?: boolean;
  effectiveType?: string;
  deviceMemoryGiB?: number;
  hidden?: boolean;
}

export interface RuntimeBudget {
  maxParallelPages: number;
  enableHedging: boolean;
  maxBytesScale: number;
  pauseBackground: boolean;
}

export interface CrawlPayload<T> {
  value: T;
  text: string;
  contentType?: string;
  canonicalUrl?: string;
  bytesRead?: number;
}

export interface CrawlPage<T> {
  url: string;
  canonicalUrl: string;
  depth: number;
  parentUrl?: string;
  payload: T;
  cacheSource: "network" | "cache";
  needsReattestation: boolean;
}

export interface CrawlFailure {
  url: string;
  depth: number;
  error: string;
}

export interface CrawlOptions {
  signal?: AbortSignal;
  maxPages?: number;
  maxDepth?: number;
  maxTotalBytes?: number;
  maxParallelPages?: number;
  maxDiscoveredPerPage?: number;
  sameOriginOnly?: boolean;
  allowBackground?: boolean;
  query?: string;
  policy?: Partial<RetrievalPolicy>;
  robotsDecision?: (url: string, signal?: AbortSignal) => Promise<"allow" | "deny" | "unknown">;
  onProgress?: (completed: number, maximum: number, url: string) => void;
  onDebug?: (message: string) => void;
}

export interface CrawlResult<T> {
  pages: CrawlPage<T>[];
  failures: CrawlFailure[];
  skippedByRobots: string[];
  discovered: number;
  bytesRead: number;
  runtimeBudget: RuntimeBudget;
}

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "ref_url",
  "igshid",
]);

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function abortError(): Error {
  const error = new Error("ABORTED");
  error.name = "AbortError";
  return error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "ABORTED");
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (milliseconds <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function fnv32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function fnv128(text: string): string {
  return [fnv32(text, 0x811c9dc5), fnv32(text, 0x9e3779b9), fnv32(text, 0x85ebca6b), fnv32(text, 0xc2b2ae35)]
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("");
}

function canonicalUrl(rawUrl: string, baseUrl?: string): string {
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return "";
  }
}

function originKey(url: string): string {
  try {
    return fnv128(new URL(url).origin);
  } catch {
    return fnv128(url);
  }
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
      return '"[undefined]"';
    case "object": {
      if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
        .join(",")}}`;
    }
    default:
      return JSON.stringify(String(value));
  }
}

function mergePolicy(policy?: Partial<RetrievalPolicy>): RetrievalPolicy {
  const merged: RetrievalPolicy = { ...DEFAULT_RETRIEVAL_POLICY, ...policy };
  merged.maxBytes = Math.max(1, Math.floor(merged.maxBytes));
  merged.freshnessMs = Math.max(0, Math.floor(merged.freshnessMs));
  merged.requiredLaneClasses = Math.max(1, Math.floor(merged.requiredLaneClasses));
  return merged;
}

export function retrievalPolicyKey(rawUrl: string, policy?: Partial<RetrievalPolicy>): string {
  const normalized = canonicalUrl(rawUrl) || rawUrl.trim();
  return `rcp\u0000${normalized}\u0000${stableSerialize(mergePolicy(policy))}`;
}

function classifyFailure(error: unknown): {
  kind: RetrievalFailureKind;
  retryAfterMs?: number;
  scope: "origin" | "lane";
} {
  if (error instanceof RetrievalControlError) return { kind: error.kind, retryAfterMs: error.retryAfterMs, scope: error.scope };
  if (isAbort(error)) return { kind: "abort", scope: "lane" };
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(?:429|502|503|504)\b/.test(message) || /rate.?limit|too many requests|timeout|timed out/i.test(message)) return { kind: "congestion", scope: "lane" };
  if (/challenge|captcha/i.test(message)) return { kind: "challenge", scope: "lane" };
  return { kind: "permanent", scope: "lane" };
}

export function readRuntimeSignals(): RuntimeSignals {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number }) : undefined;
  return {
    saveData: nav?.connection?.saveData,
    effectiveType: nav?.connection?.effectiveType,
    deviceMemoryGiB: nav?.deviceMemory,
    hidden: typeof document !== "undefined" ? document.hidden : undefined,
  };
}

export function deriveRuntimeBudget(
  requestedParallelPages: number,
  signals: RuntimeSignals = readRuntimeSignals(),
  allowBackground = false,
): RuntimeBudget {
  let parallel = clamp(Math.floor(requestedParallelPages), 1, 32);
  let enableHedging = true;
  let maxBytesScale = 1;
  if (signals.saveData) {
    parallel = 1;
    enableHedging = false;
    maxBytesScale = 0.5;
  }
  if (signals.effectiveType === "slow-2g" || signals.effectiveType === "2g") {
    parallel = 1;
    enableHedging = false;
    maxBytesScale = Math.min(maxBytesScale, 0.4);
  } else if (signals.effectiveType === "3g") {
    parallel = Math.min(parallel, 3);
    maxBytesScale = Math.min(maxBytesScale, 0.75);
  }
  if (signals.deviceMemoryGiB !== undefined && signals.deviceMemoryGiB <= 2) parallel = Math.min(parallel, 2);
  const pauseBackground = signals.hidden === true && !allowBackground;
  if (pauseBackground) {
    parallel = 1;
    enableHedging = false;
  }
  return { maxParallelPages: parallel, enableHedging, maxBytesScale, pauseBackground };
}

async function yieldToBrowser(): Promise<void> {
  const schedulerApi = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof schedulerApi?.yield === "function") {
    await schedulerApi.yield();
    return;
  }
  await delay(0);
}

interface PressureMessage {
  version: 1;
  type: "pressure";
  originKey: string;
  until: number;
}

class SharedPressureBus {
  private readonly backoffUntil = new Map<string, number>();
  private channel: BroadcastChannel | null = null;

  constructor(channelName = "retrieval-control-plane-v1") {
    try {
      if (typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel(channelName);
        this.channel.onmessage = (event: MessageEvent<PressureMessage>) => {
          const message = event.data;
          if (!message || message.version !== 1 || message.type !== "pressure" || typeof message.originKey !== "string" || !Number.isFinite(message.until)) return;
          const now = Date.now();
          const until = Math.min(message.until, now + 60_000);
          if (until <= now) return;
          this.backoffUntil.set(message.originKey, Math.max(this.backoffUntil.get(message.originKey) ?? 0, until));
        };
      }
    } catch {
      this.channel = null;
    }
  }

  async wait(admissionUrl: string, signal?: AbortSignal): Promise<void> {
    const until = this.backoffUntil.get(originKey(admissionUrl)) ?? 0;
    const wait = until - Date.now();
    if (wait > 0) await delay(wait, signal);
  }

  publish(admissionUrl: string, waitMs: number): void {
    const bounded = clamp(Math.floor(waitMs), 100, 60_000);
    const message: PressureMessage = { version: 1, type: "pressure", originKey: originKey(admissionUrl), until: Date.now() + bounded };
    this.backoffUntil.set(message.originKey, message.until);
    try {
      this.channel?.postMessage(message);
    } catch {
      /* same-tab state remains active */
    }
  }

  close(): void {
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
  }
}

interface SharedFlight<T> {
  promise: Promise<T>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}

class SharedFlights {
  private flights = new Map<string, SharedFlight<unknown>>();

  run<T>(key: string, callerSignal: AbortSignal | undefined, factory: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let flight = this.flights.get(key) as SharedFlight<T> | undefined;
    if (!flight) {
      const controller = new AbortController();
      const current: SharedFlight<T> = { controller, consumers: 0, settled: false, promise: Promise.resolve(undefined as T) };
      current.promise = factory(controller.signal).finally(() => {
        current.settled = true;
        if (this.flights.get(key) === current) this.flights.delete(key);
      });
      flight = current;
      this.flights.set(key, current as SharedFlight<unknown>);
    }
    flight.consumers += 1;
    return new Promise<T>((resolve, reject) => {
      let completed = false;
      const release = () => {
        if (completed) return;
        completed = true;
        callerSignal?.removeEventListener("abort", onAbort);
        flight!.consumers = Math.max(0, flight!.consumers - 1);
        if (flight!.consumers === 0 && !flight!.settled && !flight!.controller.signal.aborted) flight!.controller.abort();
      };
      const onAbort = () => {
        release();
        reject(abortError());
      };
      if (callerSignal?.aborted) {
        onAbort();
        return;
      }
      callerSignal?.addEventListener("abort", onAbort, { once: true });
      flight!.promise.then(
        (value) => {
          if (completed) return;
          release();
          resolve(value);
        },
        (error) => {
          if (completed) return;
          release();
          reject(error);
        },
      );
    });
  }
}

class LaneLatencyHistory {
  private samples = new Map<string, number[]>();

  record(laneClass: string, latencyMs: number): void {
    const list = this.samples.get(laneClass) ?? [];
    list.push(Math.max(0, latencyMs));
    if (list.length > 64) list.splice(0, list.length - 64);
    this.samples.set(laneClass, list);
  }

  percentile(laneClass: string, percentile: number): number | null {
    const list = this.samples.get(laneClass);
    if (!list || list.length < 4) return null;
    const sorted = list.slice().sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(clamp(percentile, 0, 1) * sorted.length));
    return sorted[index];
  }

  hedgeDelay(activeClasses: string[], defaultDelayMs: number, minimum: number, maximum: number): number {
    const estimates = activeClasses.map((laneClass) => this.percentile(laneClass, 0.9)).filter((value): value is number => value !== null);
    const estimate = estimates.length > 0 ? Math.min(...estimates) : defaultDelayMs;
    return clamp(Math.round(estimate), minimum, maximum);
  }
}

function addDiscovered(
  output: Map<string, DiscoveredUrl>,
  rawUrl: string | null,
  baseUrl: string,
  kind: DiscoveredKind,
  source: DiscoveredUrl["source"],
  priority: number,
): void {
  if (!rawUrl) return;
  const normalized = canonicalUrl(rawUrl.trim(), baseUrl);
  if (!normalized) return;
  const prior = output.get(normalized);
  if (!prior || priority > prior.priority) output.set(normalized, { url: normalized, kind, source, priority });
}

function elementText(parent: Element, localName: string): string {
  const element = parent.getElementsByTagNameNS("*", localName)[0];
  return element?.textContent?.trim() ?? "";
}

export function discoverDocumentUrls(text: string, contentType: string | undefined, baseUrl: string, maximum = 100): DiscoveredUrl[] {
  if (typeof DOMParser === "undefined" || !text.trim()) return [];
  const output = new Map<string, DiscoveredUrl>();
  const xmlLike = /(?:xml|rss|atom)/i.test(contentType ?? "") || /^\s*(?:<\?xml|<urlset|<sitemapindex|<rss|<feed)/i.test(text);
  if (xmlLike) {
    try {
      const documentXml = new DOMParser().parseFromString(text, "application/xml");
      if (documentXml.getElementsByTagName("parsererror").length === 0) {
        const root = documentXml.documentElement.localName.toLowerCase();
        if (root === "urlset") {
          const urls = Array.from(documentXml.getElementsByTagNameNS("*", "url"));
          for (const entry of urls) addDiscovered(output, elementText(entry, "loc"), baseUrl, "page", "sitemap", 40);
        } else if (root === "sitemapindex") {
          const maps = Array.from(documentXml.getElementsByTagNameNS("*", "sitemap"));
          for (const entry of maps) addDiscovered(output, elementText(entry, "loc"), baseUrl, "sitemap", "sitemap-index", 50);
        } else if (root === "rss") {
          const items = Array.from(documentXml.getElementsByTagName("item"));
          for (const item of items) addDiscovered(output, elementText(item, "link"), baseUrl, "page", "rss", 35);
        } else if (root === "feed") {
          const entries = Array.from(documentXml.getElementsByTagNameNS("*", "entry"));
          for (const entry of entries) {
            const links = Array.from(entry.getElementsByTagNameNS("*", "link"));
            const alternate = links.find((link) => ((link.getAttribute("rel") ?? "alternate").toLowerCase()) === "alternate") ?? links[0];
            addDiscovered(output, alternate?.getAttribute("href") ?? null, baseUrl, "page", "atom", 35);
          }
        }
      }
    } catch {
      /* HTML fallback below */
    }
  }
  if (output.size < maximum) {
    try {
      const documentHtml = new DOMParser().parseFromString(text, "text/html");
      for (const anchor of Array.from(documentHtml.querySelectorAll("a[href]"))) {
        addDiscovered(output, anchor.getAttribute("href"), baseUrl, "page", "html-link", 10);
        if (output.size >= maximum) break;
      }
      if (output.size < maximum) {
        for (const link of Array.from(documentHtml.querySelectorAll('link[rel~="alternate"][href]'))) {
          const type = (link.getAttribute("type") ?? "").toLowerCase();
          if (type.includes("rss") || type.includes("atom")) addDiscovered(output, link.getAttribute("href"), baseUrl, "feed", "html-feed", 45);
          if (output.size >= maximum) break;
        }
      }
    } catch {
      /* no discovery */
    }
  }
  return Array.from(output.values())
    .sort((left, right) => right.priority - left.priority || left.url.localeCompare(right.url))
    .slice(0, maximum);
}

export interface RetrievalControlPlaneOptions {
  scheduler?: SchedulerOptions;
  pressureChannelName?: string;
  crossTabLeases?: boolean;
}

export class RetrievalControlPlane {
  readonly scheduler: RetrievalScheduler;
  private readonly pressure: SharedPressureBus;
  private readonly flights = new SharedFlights();
  private readonly latency = new LaneLatencyHistory();
  private readonly crossTabLeases: boolean;

  constructor(options?: RetrievalControlPlaneOptions) {
    this.scheduler = new RetrievalScheduler(options?.scheduler);
    this.pressure = new SharedPressureBus(options?.pressureChannelName);
    this.crossTabLeases = options?.crossTabLeases !== false;
  }

  close(): void {
    this.pressure.close();
  }

  private async withCrossTabLease<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (!this.crossTabLeases || typeof navigator === "undefined") return operation();
    const locks = (navigator as Navigator & {
      locks?: { request: (name: string, options: Record<string, unknown>, callback: () => Promise<T>) => Promise<T> };
    }).locks;
    if (typeof locks?.request !== "function") return operation();
    const options: Record<string, unknown> = { mode: "exclusive" };
    if (signal) options.signal = signal;
    return locks.request(`retrieval:${fnv128(key)}`, options, operation);
  }

  executePage<T>(
    rawUrl: string,
    worker: (context: ScheduleContext, policy: RetrievalPolicy) => Promise<T>,
    options?: { admissionUrl?: string; signal?: AbortSignal; policy?: Partial<RetrievalPolicy> },
  ): Promise<ControlledExecution<T>> {
    const policy = mergePolicy(options?.policy);
    const key = retrievalPolicyKey(rawUrl, policy);
    const admissionUrl = options?.admissionUrl ?? rawUrl;
    return this.flights.run(key, options?.signal, (sharedSignal) =>
      this.withCrossTabLease(key, sharedSignal, async () => {
        const executeNetwork = async () => {
          await this.pressure.wait(admissionUrl, sharedSignal);
          try {
            return await this.scheduler.schedule(admissionUrl, (context) => worker(context, policy), sharedSignal);
          } catch (error) {
            const classified = classifyFailure(error);
            if (classified.kind === "congestion") this.pressure.publish(admissionUrl, classified.retryAfterMs ?? 1_000);
            throw error;
          }
        };
        if (policy.cacheMode === "off" || policy.freshnessMs <= 0) {
          return { value: await executeNetwork(), source: "network" as const, policyKey: key, needsReattestation: false };
        }
        const cached = await cachedValue(key, policy.freshnessMs, executeNetwork);
        return { value: cached.value, source: cached.cached ? "cache" as const : "network" as const, policyKey: key, needsReattestation: cached.cached };
      }),
    );
  }

  async hedgedQuorum<T>(lanes: LaneCandidate<T>[], options?: HedgedQuorumOptions<T>): Promise<HedgedQuorumResult<T>> {
    const startedAt = nowMs();
    const failures: LaneFailure[] = [];
    const successes: LaneSuccess<T>[] = [];
    const startedLaneIds: string[] = [];
    const distinctClasses = new Set(lanes.map((lane) => lane.laneClass)).size;
    const requiredClasses = clamp(Math.floor(options?.requiredClasses ?? 1), 1, Math.max(1, distinctClasses));
    const runtime = deriveRuntimeBudget(8);
    const ordered = lanes.slice().sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
    const maximumStarted = clamp(Math.floor(options?.maxStarted ?? Math.min(ordered.length, requiredClasses + 2)), requiredClasses, ordered.length);
    const initialFanout = runtime.enableHedging ? clamp(Math.floor(options?.initialFanout ?? requiredClasses), 1, maximumStarted) : 1;
    if (ordered.length === 0) {
      return { quorumMet: false, requiredClasses, successes, failures, startedLaneIds, blockedByOriginPolicy: false, elapsedMs: 0 };
    }
    warmupHosts(ordered.slice(0, maximumStarted).map((lane) => lane.admissionUrl), Math.min(8, maximumStarted));
    const master = new AbortController();
    const onParentAbort = () => master.abort();
    options?.signal?.addEventListener("abort", onParentAbort, { once: true });
    const successfulClasses = new Set<string>();
    let nextLane = 0;
    let active = 0;
    let finished = false;
    let blockedByOriginPolicy = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    return new Promise((resolve) => {
      const finish = () => {
        if (finished) return;
        finished = true;
        if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
        master.abort();
        options?.signal?.removeEventListener("abort", onParentAbort);
        resolve({ quorumMet: successfulClasses.size >= requiredClasses, requiredClasses, successes, failures, startedLaneIds, blockedByOriginPolicy, elapsedMs: Math.round(nowMs() - startedAt) });
      };
      const allAvailableExhausted = () => nextLane >= maximumStarted && active === 0;
      const maybeFinish = () => {
        if (successfulClasses.size >= requiredClasses || allAvailableExhausted()) finish();
      };
      const scheduleHedge = () => {
        if (finished || !runtime.enableHedging || nextLane >= maximumStarted) return;
        if (hedgeTimer !== undefined) clearTimeout(hedgeTimer);
        const delayMs = this.latency.hedgeDelay(
          ordered.slice(0, nextLane).map((lane) => lane.laneClass),
          options?.defaultHedgeDelayMs ?? 400,
          options?.minHedgeDelayMs ?? 100,
          options?.maxHedgeDelayMs ?? 2_000,
        );
        hedgeTimer = setTimeout(() => {
          hedgeTimer = undefined;
          startNext();
          scheduleHedge();
        }, delayMs);
      };
      const startNext = () => {
        if (finished || nextLane >= maximumStarted) {
          maybeFinish();
          return;
        }
        const lane = ordered[nextLane];
        nextLane += 1;
        active += 1;
        startedLaneIds.push(lane.id);
        const laneStarted = nowMs();
        void (async () => {
          try {
            await this.pressure.wait(lane.admissionUrl, master.signal);
            const value = await this.scheduler.schedule(lane.admissionUrl, (context) => lane.run(context.signal ?? master.signal), master.signal);
            const latencyMs = Math.round(nowMs() - laneStarted);
            this.latency.record(lane.laneClass, latencyMs);
            const acceptable = options?.quality ? options.quality(value, lane) : true;
            if (!acceptable) {
              failures.push({ laneId: lane.id, laneClass: lane.laneClass, kind: "permanent", message: "QUALITY_REJECTED" });
              return;
            }
            if (!successfulClasses.has(lane.laneClass)) {
              successfulClasses.add(lane.laneClass);
              successes.push({ laneId: lane.id, laneClass: lane.laneClass, value, latencyMs });
            }
          } catch (error) {
            const classified = classifyFailure(error);
            failures.push({ laneId: lane.id, laneClass: lane.laneClass, kind: classified.kind, message: error instanceof Error ? error.message : String(error) });
            if (classified.kind === "congestion") this.pressure.publish(lane.admissionUrl, classified.retryAfterMs ?? 1_000);
            if (classified.kind === "access-denied" && classified.scope === "origin") {
              blockedByOriginPolicy = true;
              finish();
            }
          } finally {
            active = Math.max(0, active - 1);
            if (!finished && successfulClasses.size < requiredClasses && active < requiredClasses - successfulClasses.size && nextLane < maximumStarted) startNext();
            maybeFinish();
          }
        })();
      };
      for (let index = 0; index < initialFanout; index += 1) startNext();
      scheduleHedge();
    });
  }

  async crawl<T>(
    seeds: string[],
    reader: (url: string, context: ScheduleContext, policy: RetrievalPolicy) => Promise<CrawlPayload<T>>,
    options?: CrawlOptions,
  ): Promise<CrawlResult<T>> {
    const maximumPages = clamp(Math.floor(options?.maxPages ?? 20), 1, 1_000);
    const maximumDepth = clamp(Math.floor(options?.maxDepth ?? 2), 0, 10);
    const maximumBytes = Math.max(1, Math.floor(options?.maxTotalBytes ?? 20_000_000));
    const maxDiscoveredPerPage = clamp(Math.floor(options?.maxDiscoveredPerPage ?? 100), 0, 10_000);
    const requestedParallel = clamp(Math.floor(options?.maxParallelPages ?? 8), 1, 32);
    const runtimeBudget = deriveRuntimeBudget(requestedParallel, readRuntimeSignals(), options?.allowBackground === true);
    const basePolicy = mergePolicy(options?.policy);
    basePolicy.maxBytes = Math.max(1, Math.floor(basePolicy.maxBytes * runtimeBudget.maxBytesScale));
    interface QueueItem {
      url: string;
      depth: number;
      priority: number;
      enqueuedAt: number;
      parentUrl?: string;
      kind: DiscoveredKind;
    }
    const queue: QueueItem[] = [];
    const seen = new Set<string>();
    const seedOrigins = new Set<string>();
    const pages: CrawlPage<T>[] = [];
    const failures: CrawlFailure[] = [];
    const skippedByRobots: string[] = [];
    let discoveredCount = 0;
    let bytesRead = 0;
    let reservedBytes = 0;
    let scheduledPages = 0;
    const enqueue = (rawUrl: string, depth: number, priority: number, kind: DiscoveredKind, parentUrl?: string) => {
      const normalized = canonicalUrl(rawUrl);
      if (!normalized || seen.has(normalized)) return;
      if (options?.sameOriginOnly !== false && seedOrigins.size > 0) {
        let origin = "";
        try {
          origin = new URL(normalized).origin;
        } catch {
          return;
        }
        if (!seedOrigins.has(origin)) return;
      }
      seen.add(normalized);
      queue.push({ url: normalized, depth, priority, enqueuedAt: Date.now(), parentUrl, kind });
      discoveredCount += 1;
    };
    for (const rawSeed of seeds) {
      const normalized = canonicalUrl(rawSeed);
      if (!normalized) continue;
      try {
        seedOrigins.add(new URL(normalized).origin);
      } catch {
        continue;
      }
    }
    for (const rawSeed of seeds) enqueue(rawSeed, 0, 100, "page");
    const popBest = (): QueueItem | undefined => {
      if (queue.length === 0) return undefined;
      const now = Date.now();
      queue.sort((left, right) => {
        const leftAging = Math.min(20, (now - left.enqueuedAt) / 1_000);
        const rightAging = Math.min(20, (now - right.enqueuedAt) / 1_000);
        return right.priority + rightAging - (left.priority + leftAging) || left.url.localeCompare(right.url);
      });
      return queue.shift();
    };
    const active = new Set<Promise<void>>();
    const launch = (item: QueueItem, reservation: number) => {
      scheduledPages += 1;
      reservedBytes += reservation;
      let promise!: Promise<void>;
      promise = (async () => {
        try {
          if (runtimeBudget.pauseBackground && typeof document !== "undefined") {
            while (document.hidden && !options?.signal?.aborted) await delay(250, options?.signal);
          }
          if (basePolicy.robotsMode !== "off" && options?.robotsDecision) {
            const decision = await options.robotsDecision(item.url, options.signal);
            if (decision === "deny" || (decision === "unknown" && basePolicy.robotsMode === "strict")) {
              skippedByRobots.push(item.url);
              return;
            }
          }
          const pagePolicy: RetrievalPolicy = { ...basePolicy, maxBytes: reservation };
          const execution = await this.executePage(item.url, (context, policy) => reader(item.url, context, policy), { signal: options?.signal, policy: pagePolicy });
          const payload = execution.value;
          const canonical = canonicalUrl(payload.canonicalUrl ?? item.url) || item.url;
          const measuredBytes = payload.bytesRead ?? new TextEncoder().encode(payload.text).byteLength;
          bytesRead += Math.min(measuredBytes, reservation);
          pages.push({ url: item.url, canonicalUrl: canonical, depth: item.depth, parentUrl: item.parentUrl, payload: payload.value, cacheSource: execution.source, needsReattestation: execution.needsReattestation });
          options?.onProgress?.(pages.length + failures.length, maximumPages, item.url);
          if (item.depth < maximumDepth && maxDiscoveredPerPage > 0) {
            const discovered = discoverDocumentUrls(payload.text, payload.contentType, canonical, maxDiscoveredPerPage);
            for (const candidate of discovered) enqueue(candidate.url, item.depth + 1, candidate.priority, candidate.kind, canonical);
          }
          await yieldToBrowser();
        } catch (error) {
          failures.push({ url: item.url, depth: item.depth, error: error instanceof Error ? error.message : String(error) });
          options?.onDebug?.(`control-plane crawl failure: ${item.url}: ${error instanceof Error ? error.message : "unknown"}`);
        } finally {
          reservedBytes = Math.max(0, reservedBytes - reservation);
          active.delete(promise);
        }
      })();
      active.add(promise);
    };
    while ((queue.length > 0 || active.size > 0) && scheduledPages < maximumPages) {
      while (active.size < runtimeBudget.maxParallelPages && queue.length > 0 && scheduledPages < maximumPages) {
        const remaining = maximumBytes - bytesRead - reservedBytes;
        if (remaining <= 0) break;
        const item = popBest();
        if (!item) break;
        const reservation = Math.min(basePolicy.maxBytes, remaining);
        if (reservation <= 0) break;
        launch(item, reservation);
      }
      if (active.size === 0) break;
      await Promise.race(active);
    }
    await Promise.all(active);
    return { pages, failures, skippedByRobots, discovered: discoveredCount, bytesRead, runtimeBudget };
  }
}

let defaultControlPlane: RetrievalControlPlane | null = null;

export function getRetrievalControlPlane(options?: RetrievalControlPlaneOptions): RetrievalControlPlane {
  if (!defaultControlPlane) defaultControlPlane = new RetrievalControlPlane(options);
  return defaultControlPlane;
}