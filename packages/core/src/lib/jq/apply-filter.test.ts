import { describe, expect, test } from "bun:test";
import { applyJqFilter, enrichResponseWithJq } from "./apply-filter";
import { resolveJqPath } from "../runner/embedded-jq";

async function jqAvailable(): Promise<boolean> {
  try {
    await resolveJqPath();
    return true;
  } catch {
    return false;
  }
}

describe("jq filter", () => {
  test("applyJqFilter extracts JSON field", async () => {
    if (!(await jqAvailable())) return;

    const raw = JSON.stringify({ users: [{ name: "Ada" }, { name: "Bob" }] });
    const result = await applyJqFilter(raw, ".users", "application/json", {
      indent: 2,
      expand_tabs: true,
      sort_keys: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filteredBody.type).toBe("json");
    if (result.filteredBody.type === "json") {
      expect(result.filteredBody.formatted).toContain("Ada");
      expect(result.filteredBody.formatted).toContain("Bob");
    }
  });

  test("enrichResponseWithJq omits filteredBody without filter", async () => {
    const body = {
      type: "json" as const,
      content: { ok: true },
      formatted: '{\n  "ok": true\n}',
    };
    const enriched = await enrichResponseWithJq(
      '{"ok":true}',
      "application/json",
      body,
      undefined,
    );
    expect(enriched.ok).toBe(true);
    if (!enriched.ok) return;
    expect(enriched.rawBody).toBe('{"ok":true}');
    expect(enriched.filteredBody).toBeUndefined();
  });
});
