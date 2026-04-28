import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AppError, binaryResult, imageResult, okResult, toErrorResult } from "../errors.js";
import { getTrackedTab, incrementToolCall, updateRefsCount, updateTabUrl } from "../state.js";
import type { ToolDeps } from "../server.js";

function buildPageHtmlExpression(selector?: string): string {
  if (!selector) {
    return "document.documentElement.outerHTML";
  }

  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);

    if (!element) {
      throw new Error("Element not found for selector: " + selector);
    }

    return element.outerHTML;
  })()`;
}

function buildQuerySelectorExpression(selector: string, attribute?: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    const attribute = ${JSON.stringify(attribute ?? null)};
    const element = document.querySelector(selector);

    if (!element) {
      return { exists: false };
    }

    if (attribute) {
      return {
        exists: true,
        attribute,
        value: element.getAttribute(attribute)
      };
    }

    const attributes = Object.fromEntries(Array.from(element.attributes, (attr) => [attr.name, attr.value]));

    return {
      exists: true,
      text: element.textContent ?? "",
      html: element.outerHTML,
      tag: element.tagName.toLowerCase(),
      attributes
    };
  })()`;
}

function buildSelectorExistsExpression(selector: string): string {
  return `(() => {
    const selector = ${JSON.stringify(selector)};
    return Boolean(document.querySelector(selector));
  })()`;
}

async function waitForSelector(
  deps: ToolDeps,
  tabId: string,
  userId: string,
  selector: string,
  timeoutMs = 10_000
): Promise<void> {
  const pollInterval = 500;

  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let inFlight = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      clearInterval(intervalId);
      callback();
    };

    const tick = async () => {
      if (settled || inFlight) {
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        settle(() => reject(new AppError("TIMEOUT", `Selector "${selector}" not found within ${timeoutMs}ms`)));
        return;
      }

      inFlight = true;

      try {
        const result = await deps.client.evaluate(tabId, buildSelectorExistsExpression(selector), userId);

        if (!result.ok) {
          settle(() => reject(new AppError("INTERNAL_ERROR", result.error ?? `Failed to evaluate selector "${selector}"`)));
          return;
        }

        if (result.result === true) {
          settle(resolve);
        }
      } catch (error) {
        settle(() => reject(error));
      } finally {
        inFlight = false;
      }
    };

    const intervalId = setInterval(() => {
      void tick();
    }, pollInterval);

    void tick();
  });
}

export function registerObservationTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    "snapshot",
    "Get accessibility tree snapshot — the PRIMARY way to read page content. Returns element refs, roles, names and values. Token-efficient. Always prefer over screenshot. Refs come from the accessibility tree, so custom SPA elements may be missing; fall back to CSS selectors, camofox_wait_for_selector, or camofox_get_page_html when needed.\n\nTask-aware scoping (optional): pass focus_selector to limit the snapshot to a subtree (e.g. an open dialog), roles_filter to keep only specific roles (parents preserved), max_lines to cap size, current_task and last_action to inject a task banner that helps the model stay focused.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      offset: z.number().optional().describe("Offset for paginating large snapshots. Use nextOffset from previous response."),
      focus_selector: z.string().optional().describe("CSS selector to scope the snapshot to a subtree (e.g. '[role=dialog]'). When set, ignores offset/pagination."),
      max_lines: z.number().int().min(10).max(5000).optional().describe("Hard cap on YAML lines after filtering. Useful with roles_filter or focus_selector."),
      roles_filter: z.array(z.string()).optional().describe("Restrict YAML to nodes whose role matches any of these (e.g. ['button','checkbox','dialog']). Ancestor lines are preserved for context."),
      current_task: z.string().max(200).optional().describe("Short task descriptor injected as a YAML banner (helps the LLM stay focused)."),
      last_action: z.string().max(200).optional().describe("Last action narrative injected as a YAML banner (drift detection / context).")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({
          tabId: z.string().min(1),
          offset: z.number().optional(),
          focus_selector: z.string().optional(),
          max_lines: z.number().int().min(10).max(5000).optional(),
          roles_filter: z.array(z.string()).optional(),
          current_task: z.string().max(200).optional(),
          last_action: z.string().max(200).optional()
        }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const scoped = (parsed.focus_selector || parsed.max_lines || parsed.roles_filter || parsed.current_task || parsed.last_action)
          ? {
              focusSelector: parsed.focus_selector,
              maxLines: parsed.max_lines,
              rolesFilter: parsed.roles_filter,
              currentTask: parsed.current_task,
              lastAction: parsed.last_action
            }
          : (tracked.currentTask || tracked.lastAction)
            ? {
                currentTask: tracked.currentTask,
                lastAction: tracked.lastAction
              }
            : undefined;
        const response = await deps.client.snapshot(parsed.tabId, tracked.userId, parsed.offset, scoped);
        incrementToolCall(parsed.tabId);
        updateTabUrl(parsed.tabId, response.url);
        updateRefsCount(parsed.tabId, response.refsCount);

        const result: {
          url: string;
          snapshot: string;
          refsCount: number;
          truncated?: boolean;
          totalChars?: number;
          hasMore?: boolean;
          nextOffset?: number | null;
          truncationInfo?: string;
          scoped?: boolean;
          newElementsCount?: number;
        } = {
          url: response.url,
          snapshot: response.snapshot,
          refsCount: response.refsCount
        };

        if (response.scoped) result.scoped = true;
        if (response.newElementsCount && response.newElementsCount > 0) {
          result.newElementsCount = response.newElementsCount;
        }

        if (response.truncated) {
          result.truncated = response.truncated;
          result.totalChars = response.totalChars;
          result.hasMore = response.hasMore;
          result.nextOffset = response.nextOffset;
          result.truncationInfo = response.hasMore
            ? `TRUNCATED (${response.totalChars ?? "unknown"} total chars) | next offset: ${response.nextOffset ?? "unknown"}`
            : `TRUNCATED (${response.totalChars ?? "unknown"} total chars)`;
        }

        return okResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "snapshot_dialog",
    "Capture only the topmost open dialog/alertdialog (Radix-aware via [data-state=open]). Returns null snapshot when no dialog is visible. Use after a click that opens a modal to get a focused, low-token view of just the dialog content.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({ tabId: z.string().min(1) }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const response = await deps.client.snapshotDialog(parsed.tabId, tracked.userId);
        incrementToolCall(parsed.tabId);
        updateTabUrl(parsed.tabId, response.url);
        if (response.refsCount > 0) updateRefsCount(parsed.tabId, response.refsCount);
        return okResult({
          url: response.url,
          snapshot: response.snapshot,
          refsCount: response.refsCount,
          selector: response.selector,
          dialogVisible: response.snapshot !== null
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "camofox_get_page_html",
    "Get rendered HTML from the live DOM. Use when snapshot refs are incomplete on SPA/custom-component sites or when you need the final DOM state rather than the accessibility tree. Optionally pass a CSS selector to return only that element's outerHTML instead of the full page. Requires CAMOFOX_API_KEY.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      selector: z.string().min(1).optional().describe("Optional CSS selector to scope HTML extraction to a single element")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({
          tabId: z.string().min(1).describe("Tab ID from create_tab"),
          selector: z.string().min(1).optional().describe("Optional CSS selector to scope HTML extraction to a single element")
        }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const result = await deps.client.evaluate(parsed.tabId, buildPageHtmlExpression(parsed.selector), tracked.userId);

        if (!result.ok) {
          throw new AppError(
            /element|selector/i.test(result.error ?? "") ? "ELEMENT_NOT_FOUND" : "INTERNAL_ERROR",
            result.error ?? "Failed to read page HTML"
          );
        }

        if (typeof result.result !== "string") {
          throw new AppError("INTERNAL_ERROR", "Page HTML did not return a string result");
        }

        incrementToolCall(parsed.tabId);
        return okResult({ html: result.result });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "camofox_query_selector",
    "Query a CSS selector in the live DOM and return its element details or a specific attribute. Use this for targeted inspection without writing raw evaluate_js. Requires CAMOFOX_API_KEY.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      selector: z.string().min(1).describe("CSS selector to query"),
      attribute: z.string().min(1).optional().describe("Optional attribute name to return instead of the full element payload")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({
          tabId: z.string().min(1).describe("Tab ID from create_tab"),
          selector: z.string().min(1).describe("CSS selector to query"),
          attribute: z.string().min(1).optional().describe("Optional attribute name to return instead of the full element payload")
        }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const result = await deps.client.evaluate(
          parsed.tabId,
          buildQuerySelectorExpression(parsed.selector, parsed.attribute),
          tracked.userId
        );

        if (!result.ok) {
          throw new AppError("INTERNAL_ERROR", result.error ?? "Failed to query selector");
        }

        incrementToolCall(parsed.tabId);
        return okResult(result.result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "screenshot",
    "Take visual screenshot. Use ONLY for visual verification (CSS, layout, proof). Prefer snapshot for most tasks — much more token-efficient.\n\nVision-cost controls (optional): pass type='jpeg' + quality (1-100) to shrink payload (low detail), or clip {x,y,width,height} to capture only a region. clip is the recommended way to keep vision tokens low when verifying a single component.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      fullPage: z.boolean().optional().describe("Capture entire scrollable page. Default false (viewport only)."),
      type: z.enum(["png", "jpeg"]).optional().describe("Image format. JPEG enables `quality` and reduces size. Default png."),
      quality: z.number().int().min(1).max(100).optional().describe("JPEG quality (1-100). Lower = smaller payload = lower vision detail. Ignored when type=png."),
      clip: z.object({
        x: z.number().min(0),
        y: z.number().min(0),
        width: z.number().positive(),
        height: z.number().positive()
      }).optional().describe("Clip region in CSS pixels. Strongly preferred for vision-cost reduction.")
    },
    async (input: unknown) => {
      try {
        const parsed = z.object({
          tabId: z.string().min(1),
          fullPage: z.boolean().optional(),
          type: z.enum(["png", "jpeg"]).optional(),
          quality: z.number().int().min(1).max(100).optional(),
          clip: z.object({
            x: z.number().min(0),
            y: z.number().min(0),
            width: z.number().positive(),
            height: z.number().positive()
          }).optional()
        }).parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const { buffer, mime } = await deps.client.screenshot(parsed.tabId, tracked.userId, {
          fullPage: parsed.fullPage,
          type: parsed.type,
          quality: parsed.quality,
          clip: parsed.clip
        });
        incrementToolCall(parsed.tabId);
        if (mime === "image/jpeg") {
          return binaryResult(buffer.toString("base64"), mime);
        }
        return imageResult(buffer.toString("base64"));
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "get_links",
    "Get all hyperlinks on page with URLs and text. Useful for navigation discovery and site mapping.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      scope: z.string().min(1).optional().describe("CSS selector to scope link extraction to a container"),
      extension: z.string().min(1).optional().describe("Filter by extension, comma-separated (e.g. 'pdf,zip')"),
      downloadOnly: z.boolean().optional().describe("Only include links with a download attribute")
    },
    async (input: unknown) => {
      try {
        const parsed = z
          .object({
            tabId: z.string().min(1).describe("Tab ID from create_tab"),
            scope: z.string().min(1).optional().describe("CSS selector to scope link extraction to a container"),
            extension: z.string().min(1).optional().describe("Filter by extension, comma-separated (e.g. 'pdf,zip')"),
            downloadOnly: z.boolean().optional().describe("Only include links with a download attribute")
          })
          .parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        const response = await deps.client.getLinksWithOptions(parsed.tabId, tracked.userId, {
          scope: parsed.scope,
          extension: parsed.extension,
          downloadOnly: parsed.downloadOnly
        });
        incrementToolCall(parsed.tabId);
        return okResult(response.links);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "camofox_wait_for_text",
    "Wait for specific text to appear on the page. Useful for waiting for search results, form submissions, or dynamic content loading.",
    {
      tabId: z.string().describe("Tab ID"),
      text: z.string().describe("Text to wait for"),
      timeout: z.number().optional().describe("Timeout in ms (default: 10000)")
    },
    async (input: unknown) => {
      try {
        const parsed = z
          .object({
            tabId: z.string().describe("Tab ID"),
            text: z.string().describe("Text to wait for"),
            timeout: z.number().optional().describe("Timeout in ms (default: 10000)")
          })
          .parse(input);
        const tracked = getTrackedTab(parsed.tabId);
        await deps.client.waitForText(parsed.tabId, tracked.userId, parsed.text, parsed.timeout);
        incrementToolCall(parsed.tabId);
        return okResult({ message: `Text \"${parsed.text}\" found on page` });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    "camofox_wait_for_selector",
    "Wait for a CSS selector to appear in the live DOM. Use for SPA hydration and async content when snapshot refs are incomplete or stale. Once found, prefer snapshot refs for interaction when available. Requires CAMOFOX_API_KEY.",
    {
      tabId: z.string().min(1).describe("Tab ID from create_tab"),
      selector: z.string().min(1).describe("CSS selector to wait for"),
      timeout: z.number().int().positive().optional().default(10000).describe("Timeout in ms (default: 10000)")
    },
    async (input: unknown) => {
      try {
        const parsed = z
          .object({
            tabId: z.string().min(1).describe("Tab ID from create_tab"),
            selector: z.string().min(1).describe("CSS selector to wait for"),
            timeout: z.number().int().positive().optional().default(10000).describe("Timeout in ms (default: 10000)")
          })
          .parse(input);
        const tracked = getTrackedTab(parsed.tabId);

        await waitForSelector(deps, parsed.tabId, tracked.userId, parsed.selector, parsed.timeout);
        incrementToolCall(parsed.tabId);

        return okResult({
          success: true,
          message: `Selector "${parsed.selector}" found on page`
        });
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
