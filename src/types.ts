export interface Config {
  camofoxUrl: string;
  apiKey?: string;
  defaultUserId: string;
  profilesDir: string;
  timeout: number;
  autoSave: boolean;
  transport: "stdio" | "http";
  httpPort: number;
  httpHost: string;
  httpRateLimit: number;
  browserServerPath?: string;
  httpApiKey?: string;
  httpAllowedHosts?: string[];
  defaultViewport?: { width: number; height: number };
}

export interface HealthResponse {
  ok: boolean;
  running?: boolean;
  browserConnected: boolean;
  version?: string;
  consecutiveFailures?: number;
  activeOps?: number;
}

export type GeoMode = "explicit-wins" | "proxy-locked";

export interface RawProxyOverride {
  host: string;
  port: string;
  username?: string;
  password?: string;
}

export interface CreateTabParams {
  userId: string;
  sessionKey: string;
  url?: string;
  preset?: string;
  locale?: string;
  timezoneId?: string;
  geolocation?: { latitude: number; longitude: number };
  viewport?: { width: number; height: number };
  proxyProfile?: string;
  proxy?: RawProxyOverride;
  geoMode?: GeoMode;
}

export interface PresetInfo {
  locale: string;
  timezoneId: string;
  geolocation?: { latitude: number; longitude: number };
}

export interface PresetsResponse {
  presets: Record<string, PresetInfo>;
}

export interface TabResponse {
  tabId: string;
  url: string;
  title?: string;
}

export interface NavigateResponse {
  url: string;
  title?: string;
  refsAvailable?: boolean;
}

export type ClickStrategy = "locator" | "force" | "mouse" | "jsdispatch" | "keyboard-space";

export interface ClickParams {
  ref?: string;
  selector?: string;
  /** Per-strategy Playwright timeout in ms. 1000-30000 (default 5000). */
  timeout?: number;
  /** Skip the plain locator click and start at force/mouse fallback chain. */
  force?: boolean;
  /** After click, verify a state change (aria-checked, data-state, value, URL). */
  verify?: boolean;
}

export interface ClickResponse {
  success: boolean;
  navigated: boolean;
  refsAvailable?: boolean;
  /** Which strategy in the fallback chain ultimately succeeded. */
  strategy?: ClickStrategy;
  /** Total click attempts across the strategy ladder. */
  attempts?: number;
  /** Only present when verify=true was requested. */
  verifiedStateChange?: boolean;
}

export interface SnapshotResponse {
  url: string;
  snapshot: string;
  refsCount: number;
  truncated?: boolean;
  totalChars?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
  /** True when server applied focusSelector / rolesFilter / maxLines. */
  scoped?: boolean;
  /** Count of lines marked with `*` (new since previous snapshot). */
  newElementsCount?: number;
}

export interface SnapshotScopedParams {
  /** CSS selector to scope snapshot to a subtree. */
  focusSelector?: string;
  /** Hard cap on lines after filtering. */
  maxLines?: number;
  /** Restrict YAML to nodes whose role matches one of these. */
  rolesFilter?: string[];
  /** Optional task descriptor — added as a YAML banner to inform the LLM. */
  currentTask?: string;
  /** Last action narrative (for drift detection / context). */
  lastAction?: string;
}

export interface SnapshotDialogResponse {
  url: string;
  /** null when no open dialog is detected. */
  snapshot: string | null;
  refsCount: number;
  /** Selector that matched (e.g. [role="dialog"][data-state="open"]). */
  selector: string | null;
}

export interface NavigationActionResponse {
  url: string;
  title?: string;
  refsAvailable?: boolean;
}

export interface YouTubeTranscriptResponse {
  status: string;
  transcript?: string;
  video_url?: string;
  video_id: string;
  video_title?: string;
  language?: string;
  total_words?: number;
  available_languages?: Array<{ code: string; name: string; kind: string }>;
  message?: string;
  code?: number;
}

export interface LinkItem {
  text: string;
  href: string;
}

export interface LinkResponse {
  links: LinkItem[];
}

export interface StatsResponse {
  visitedUrls?: string[];
  [key: string]: unknown;
}

export interface ToggleDisplayResponse {
  ok: boolean;
  headless: boolean | "virtual";
  message: string;
  userId: string;
  tabsInvalidated?: boolean;
  vncUrl?: string;
}

export interface TabInfo {
  tabId: string;
  url: string;
  createdAt: string;
  lastActivity: number;
  userId: string;
  sessionKey: string;
  visitedUrls: string[];
  toolCalls: number;
  refsCount: number;
  /** High-level objective the agent is currently pursuing on this tab. */
  currentTask?: string;
  /** Rolling history of tasks/actions (capped, FIFO). Most recent first. */
  taskHistory?: TaskHistoryEntry[];
  /** Last completed action narrative (e.g. "click ref=e12 (force)"). */
  lastAction?: string;
}

export interface TaskHistoryEntry {
  ts: number;
  /** "task" = explicit set_task_context; "action" = auto-tracked from click/type/navigate. */
  kind: "task" | "action";
  text: string;
}

export type SearchEngine =
  | "google"
  | "youtube"
  | "amazon"
  | "bing"
  | "duckduckgo"
  | "reddit"
  | "github"
  | "stackoverflow"
  | "wikipedia"
  | "twitter"
  | "linkedin"
  | "facebook"
  | "instagram"
  | "tiktok";

export interface ProfileCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  [key: string]: unknown;
}

export interface ProfileMetadata {
  createdAt: string;
  updatedAt: string;
  lastUrl?: string | null;
  description?: string | null;
  cookieCount: number;
}

export interface Profile {
  version: 1;
  profileId: string;
  userId: string;
  cookies: ProfileCookie[];
  metadata: ProfileMetadata;
}
