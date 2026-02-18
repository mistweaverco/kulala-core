import { expect, test } from "bun:test";
import {
  buildHeadersFromSection,
  setUserAgentHeaderIfNotPresent,
} from "./headers";

test("buildHeadersFromSection builds record from header entries", () => {
  const section = [
    {
      type: "header" as const,
      name: "Content-Type",
      value: "application/json",
    },
    { type: "header" as const, name: "X-Custom", value: "value" },
    {
      type: "comment" as const,
      comment: { lineNumber: 1, comment: "# comment" },
    },
  ];
  const out = buildHeadersFromSection(section);
  expect(out).toEqual({
    "Content-Type": "application/json",
    "X-Custom": "value",
  });
});

test("buildHeadersFromSection merges duplicate header names with ; ", () => {
  const section = [
    { type: "header" as const, name: "Cookie", value: "a=1" },
    { type: "header" as const, name: "Cookie", value: "b=2" },
  ];
  const out = buildHeadersFromSection(section);
  expect(out).toEqual({ Cookie: "a=1; b=2" });
});

test("setUserAgentHeaderIfNotPresent adds User-Agent when missing", () => {
  const headers = { "Content-Type": "application/json" };
  const out = setUserAgentHeaderIfNotPresent(headers);
  expect(out["User-Agent"]).toMatch(/^kulala-core\/\d+\.\d+\.\d+$/);
  expect(out["Content-Type"]).toBe("application/json");
});

test("setUserAgentHeaderIfNotPresent does not override existing User-Agent", () => {
  const headers = { "User-Agent": "MyClient/1.0" };
  const out = setUserAgentHeaderIfNotPresent(headers);
  expect(out["User-Agent"]).toBe("MyClient/1.0");
});

test("setUserAgentHeaderIfNotPresent does not override existing user-agent (lowercase)", () => {
  const headers = { "user-agent": "Other/2.0" };
  const out = setUserAgentHeaderIfNotPresent(headers);
  expect(out["user-agent"]).toBe("Other/2.0");
});
