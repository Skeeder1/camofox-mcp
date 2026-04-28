# Référence — Types

Recensement des types principaux exportés ou utilisés en interne. Source : [src/types.ts](../../src/types.ts), [src/state.ts](../../src/state.ts), [src/llm/](../../src/llm/), [src/profiles.ts](../../src/profiles.ts).

## Tabs & state

### `TabInfo`

```ts
export interface TabInfo {
  tabId: string;
  userId: string;
  sessionKey: string;
  url: string;
  visitedUrls: string[];                 // cap 50, push back, shift front
  refsCount: number;                     // dernière valeur post-snapshot
  toolCalls: number;
  createdAt: number;                     // Date.now()
  lastActivity: number;
  taskHistory: TaskHistoryEntry[];       // cap 10
  currentTask?: string;                  // max 500 chars
  lastAction?: string;
  lastSnapshotHash?: string;             // sha256 du dernier snapshot
}

export interface TaskHistoryEntry {
  ts: number;                            // Date.now() de l'action
  action: string;                        // "click e5 (locator)", "navigate https://...", ...
}
```

### `TabInfoPublic`

Identique à `TabInfo` mais sans `taskHistory` (réduit la taille des `list_tabs`).

```ts
export type TabInfoPublic = Omit<TabInfo, "taskHistory">;
```

## Click

### `ClickStrategy`

```ts
export type ClickStrategy =
  | "locator"
  | "force"
  | "mouse"
  | "jsdispatch"
  | "keyboard-space";
```

### `ClickParams`

```ts
export interface ClickParams {
  ref?: string;
  selector?: string;
  strategy?: ClickStrategy;
  retries?: number;                      // 0-5, défaut 3
  verify?: boolean;                      // défaut false
  pre_wait_ms?: number;                  // 0-5000
  post_wait_ms?: number;                 // 0-5000
}

export interface ClickResponse {
  clicked: boolean;
  strategy?: ClickStrategy;              // celle qui a réussi
  retries_used?: number;
  verified?: boolean;                    // si verify=true et changement constaté
}
```

## Snapshots

### `SnapshotResponse`

```ts
export interface SnapshotResponse {
  url: string | null;
  snapshot: string | null;               // YAML ARIA
  refsCount: number;
  truncated: boolean;
  totalChars: number;
  hasMore: boolean;
  nextOffset: number | null;
  scoped: boolean;
  newElementsCount?: number;             // refs marqués "*" (nouveaux depuis dernier snapshot)
}
```

### `SnapshotScopedParams`

```ts
export interface SnapshotScopedParams {
  focusSelector?: string;
  maxLines?: number;                     // 10-5000
  rolesFilter?: string[];                // ["button","checkbox",...]
  currentTask?: string;                  // max 200, banner injection
  lastAction?: string;                   // max 200
}
```

### `SnapshotDialogResponse`

```ts
export interface SnapshotDialogResponse {
  url: string | null;
  snapshot: string | null;               // null si pas de dialog ouvert
  refsCount: number;
  selector: string;                      // le sélecteur utilisé pour matcher le dialog
  dialogVisible: boolean;
}
```

## Navigation

### `NavigationActionResponse`

```ts
export interface NavigationActionResponse {
  url: string | null;
  snapshot: string | null;               // optionnel — auto-snapshot après go_back/go_forward
  refsCount: number;
}
```

## YouTube

### `YouTubeTranscriptResponse`

```ts
export interface YouTubeTranscriptResponse {
  transcript: Array<{
    text: string;
    start: number;                       // secondes
    duration: number;
  }>;
}
```

## Liens

### `LinkItem`

```ts
export interface LinkItem {
  text: string;
  href: string;
}

export interface LinkResponse {
  links: LinkItem[];
}
```

## Stats

### `StatsResponse`

```ts
export interface StatsResponse {
  visitedUrls: string[];
  toolCalls: number;
  refsCount: number;
  sessionKey: string;
  remote?: unknown;                      // stats brutes du browser-side
}
```

## Display

### `ToggleDisplayResponse`

```ts
export interface ToggleDisplayResponse {
  ok: boolean;
  mode: "headless" | "headed" | "virtual";
  vncUrl?: string;                       // mode virtual seulement
}
```

## Search

### `SearchEngine`

```ts
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
```

## Profils

### `ProfileCookie`

```ts
export interface ProfileCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  // .passthrough() — accepte des champs additionnels du browser (priority, partitionKey, ...)
}
```

### `ProfileMetadata`

```ts
export interface ProfileMetadata {
  createdAt: string;                     // ISO 8601
  updatedAt: string;
  lastUrl?: string | null;
  description?: string | null;
  cookieCount: number;
}
```

### `Profile`

```ts
export interface Profile {
  version: 1;
  profileId: string;
  userId: string;
  cookies: ProfileCookie[];
  metadata: ProfileMetadata;
}
```

## LLM

### `LLMMessage`

```ts
export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
};

export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };  // base64
```

### `LLMConfig`

(Voir détails dans [04-llm/configuration.md](../04-llm/configuration.md).)

```ts
export interface LLMConfig {
  enabled: boolean;
  provider: "openrouter" | "openai" | "anthropic" | "gemini" | "custom";
  apiUrl: string;
  apiKey: string | undefined;
  defaultModel: string;
  fallbackModel?: string;
  visionModel: string;
  perPurposeModels: Partial<Record<string, string>>;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  jsonFormat: boolean;
  preferSampling: boolean;
}
```

### `LLMTelemetryEvent`

```ts
export type LLMTelemetryEvent = {
  ts: string;
  purpose: string;
  model: string;
  provider: string;
  status: "ok" | "error" | "fallback_used" | "repaired";
  latencyMs: number;
  usage?: { prompt: number; completion: number; total: number };
  error?: string;
};
```

### `RouterCounters`

```ts
export interface RouterCounters {
  totalCalls: number;
  okCalls: number;
  errorCalls: number;
  repairedCalls: number;
  fallbackCalls: number;
  totalLatencyMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}
```

## Layers

### `LayerProfile` & `Flags`

```ts
export type LayerProfile = "lean" | "full" | "custom";

export interface Flags {
  health: boolean;       // L0 — toujours true
  tabs: boolean;         // L0 — toujours true
  navigation: boolean;   // L0 — toujours true
  session: boolean;      // L0 — toujours true
  semantic: boolean;     // L1 — true en lean & full
  legacy: boolean;       // L_LEGACY — true en full uniquement
}
```

(Voir [02-configuration/layers-profiles.md](../02-configuration/layers-profiles.md).)

## Errors

### `AppError`

```ts
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, status?: number, details?: unknown);
}

export type ErrorCode =
  | "TAB_NOT_FOUND"
  | "MAX_TABS_EXCEEDED"
  | "ELEMENT_NOT_FOUND"
  | "API_KEY_REQUIRED"
  | "CONNECTION_REFUSED"
  | "TIMEOUT"
  | "NAVIGATION_FAILED"
  | "VALIDATION_ERROR"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_ERROR"
  | "INTERNAL_ERROR";
```

## Config

### `Config`

```ts
export interface Config {
  // HTTP
  http: boolean;
  port: number;
  host: string;
  rateLimit: { max: number; windowMs: number };

  // Client
  camofoxUrl: string;
  apiKey?: string;
  timeout: number;
  defaultUserId: string;

  // State
  tabTtlMs: number;
  maxTabs: number;
  sweepIntervalMs: number;

  // Profiles
  autoSave: boolean;
  profilesDir: string;

  // Layers
  layer: LayerProfile;
  flags: Flags;

  // LLM
  llm: LLMConfig;
}
```
