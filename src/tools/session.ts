import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AppError, okResult, toErrorResult } from "../errors.js";
import { clearTrackedTabsByUserId, getAllTrackedTabs, getTrackedTab, incrementToolCall, setTabTask, clearTabTask, getTabTaskContext } from "../state.js";
import { saveProfile, withAutoTimeout } from "../profiles.js";
import type { ToolDeps } from "../server.js";

const AUTO_PROFILE_TIMEOUT_MS = 5_000;

export function registerSessionTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    "import_cookies",
    "Import cookies for authenticated sessions. Provide cookies in a JSON string array. Restores login sessions without re-auth. Requires userId.",
    {
      userId: z.string().min(1).describe("User ID for session isolation"),
      cookies: z.string().min(1).describe("JSON string of cookie array to import"),
      tabId: z.string().optional().describe("Tab ID to target correct session (needed when using presets)")
    },
    async (input: unknown) => {
      try {
        const parsed = z
          .object({
            userId: z.string().min(1).describe("User ID for session isolation"),
            cookies: z.string().min(1).describe("JSON string of cookie array to import"),
            tabId: z.string().optional().describe("Tab ID to target correct session (needed when using presets)")
          })
          .parse(input);

        let cookies: unknown;
        try {
          cookies = JSON.parse(parsed.cookies);
        } catch {
          throw new AppError("VALIDATION_ERROR", "cookies must be a JSON array");
        }

        if (!Array.isArray(cookies)) {
          throw new AppError("VALIDATION_ERROR", "cookies must be a JSON array");
        }

        await deps.client.importCookies(parsed.userId, cookies, parsed.tabId);
        return okResult({ success: true });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "get_stats",
    "Get session statistics: request counts, active tabs, uptime, performance metrics.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({ tabId: z.string().min(1).describe("Tab ID from create_tab") }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const remoteStats = await deps.client.getStats(parsed.tabId, tracked.userId);
        incrementToolCall(parsed.tabId);

        return okResult({
          visitedUrls: tracked.visitedUrls,
          toolCalls: tracked.toolCalls,
          refsCount: tracked.refsCount,
          sessionKey: tracked.sessionKey,
          remote: remoteStats
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "camofox_close_session",
    "Close all browser tabs for a user session. Use for complete cleanup when done with a browsing session.",
    {
      tabId: z.string().describe("Any tab ID from the session to identify the user")
    },
    async (input: unknown) => {
      try {
        const parsed = z
          .object({
            tabId: z.string().describe("Any tab ID from the session to identify the user")
          })
          .parse(input);
        const tracked = getTrackedTab(parsed.tabId);

        let autoSaved = false;
        // Auto-save before session close (best-effort; never blocks close)
        if (deps.config.autoSave) {
          const saved = await withAutoTimeout(
            (async () => {
              const allTabs = getAllTrackedTabs().filter((t) => t.userId === tracked.userId);
              const tabForExport = allTabs.find((t) => t.tabId === parsed.tabId) ?? allTabs[0];
              if (!tabForExport) {
                return false;
              }

              const cookies = await deps.client.exportCookies(tabForExport.tabId, tracked.userId);
              if (cookies.length <= 0) {
                return false;
              }

              const autoProfileId = `_auto_${tracked.userId}`;
              await saveProfile(deps.config.profilesDir, autoProfileId, tracked.userId, cookies, {
                description: "Auto-saved session",
                lastUrl: tabForExport.url
              });
              return true;
            })(),
            AUTO_PROFILE_TIMEOUT_MS
          );
          autoSaved = saved.ok ? saved.value : false;
        }

        try {
          await deps.client.closeSession(tracked.userId);
        } finally {
          clearTrackedTabsByUserId(tracked.userId);
        }
        return okResult({
          message: `Session closed. All tabs for user ${tracked.userId} have been released.`,
          autoSaved
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "toggle_display",
    "Toggle browser display mode between headless and headed. When encountering CAPTCHAs or issues requiring visual interaction, switch to headed mode (headless: false) to show the browser window. After resolving, switch back to headless mode (headless: true). When switching to virtual or headed mode, the response includes a vncUrl field — open this URL in a browser to see and interact with the browser GUI. Note: This restarts the browser context — all tabs are invalidated but cookies/auth persist.",
    {
      userId: z.string().min(1).describe("User/session identifier"),
      headless: z
        .union([z.boolean(), z.literal("virtual")])
        .describe("Display mode — false for headed, true for headless, \"virtual\" for virtual display")
    },
    async (input: unknown) => {
      try {
        const parsed = z
          .object({
            userId: z.string().min(1).describe("User/session identifier"),
            headless: z
              .union([z.boolean(), z.literal("virtual")])
              .describe("Display mode — false for headed, true for headless, \"virtual\" for virtual display")
          })
          .parse(input);

        const result = await deps.client.toggleDisplay(parsed.userId, parsed.headless);
        clearTrackedTabsByUserId(parsed.userId);

        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "set_task_context",
    "Persist a high-level task descriptor on a tab. Subsequent snapshots can inject this as a banner via current_task. Helps the model stay focused across multi-step flows. Pass task='' to clear.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      task: z.string().max(500).describe("Short task description, e.g. 'apply LeBonCoin filters: Renault, 2018-2022, <100k km'. Empty string clears the task.")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({
          tabId: z.string().min(1),
          task: z.string().max(500)
        }).parse(input);
        // Touch the tab to make sure it exists.
        const tracked = getTrackedTab(parsed.tabId);
        if (parsed.task.trim().length === 0) {
          clearTabTask(parsed.tabId);
        } else {
          setTabTask(parsed.tabId, parsed.task);
        }
        incrementToolCall(parsed.tabId);
        return okResult({
          ok: true,
          tabId: parsed.tabId,
          currentTask: parsed.task.trim().length === 0 ? null : parsed.task.trim().slice(0, 500),
          url: tracked.url
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "get_task_context",
    "Read the persistent task context for a tab: current task, last action, recent history (most recent first, capped at CAMOFOX_TASK_HISTORY_MAX = 10).",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({ tabId: z.string().min(1) }).parse(input);
        const ctx = getTabTaskContext(parsed.tabId);
        return okResult(ctx);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "diagnose_failure",
    "Run a fast post-failure diagnostic on a tab: returns task context, last action, current URL, dialog visibility, and a short rule-based hint (Radix toggle, dialog blocker, drift). Call this AFTER a click/navigate that returned an unexpected result, BEFORE retrying. Cheap — no LLM, no screenshot.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({ tabId: z.string().min(1) }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const ctx = getTabTaskContext(parsed.tabId);
        const dialog = await deps.client.snapshotDialog(parsed.tabId, tracked.userId).catch(() => null);
        const hints: string[] = [];
        if (dialog && dialog.snapshot) {
          hints.push(`open_dialog (${dialog.selector}) — capture it via snapshot_dialog and dismiss before retrying.`);
        }
        const lastAction = ctx.lastAction ?? "";
        if (/click .* \(force\)/i.test(lastAction) && /verified\b/.test(lastAction) === false) {
          hints.push("last click used force fallback but was NOT verified — re-issue with verify:true.");
        }
        if (/click .* (locator|jsdispatch)/i.test(lastAction)) {
          hints.push("standard click chain — if state did not change, re-issue with force:true and verify:true (likely Radix controlled component).");
        }
        const recent = (ctx.taskHistory ?? []).slice(0, 3).map((e) => `${e.kind}: ${e.text}`);
        if (recent.length >= 2 && recent.every((r) => r.startsWith("action: click "))) {
          hints.push("multiple consecutive click attempts on this tab — STOP retrying the same element. Re-snapshot or call snapshot_dialog.");
        }
        if (hints.length === 0) hints.push("no obvious blocker. Take a fresh snapshot with current_task and inspect new_elements (* markers).");
        incrementToolCall(parsed.tabId);
        return okResult({
          tabId: parsed.tabId,
          url: tracked.url,
          currentTask: ctx.currentTask ?? null,
          lastAction: ctx.lastAction ?? null,
          dialogVisible: Boolean(dialog && dialog.snapshot),
          dialogSelector: dialog?.selector ?? null,
          recentHistory: recent,
          hints
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
