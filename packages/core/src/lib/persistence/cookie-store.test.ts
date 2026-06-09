import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDb, getDbInMemory, setDbForTesting } from "./db";
import {
  getCookieHeaderForRequest,
  mergeCookieHeaderValues,
  parseCookieHeaderValue,
  selectCookieHeaderCandidates,
  storeCookiesFromResponse,
} from "./cookie-store";

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("parseCookieHeaderValue: last duplicate name wins", () => {
  expect(parseCookieHeaderValue("a=1; b=2; a=3")).toEqual({ a: "3", b: "2" });
});

test("mergeCookieHeaderValues: later header wins for same name", () => {
  expect(mergeCookieHeaderValues("a=1; b=1", "a=2; c=3")).toBe("a=2; b=1; c=3");
});

test("getCookieHeaderForRequest: same name at different paths keeps most specific", () => {
  storeCookiesFromResponse("http://example.com/", ["sid=root; Path=/"]);
  storeCookiesFromResponse("http://example.com/api/foo", [
    "sid=api; Path=/api",
  ]);

  expect(getCookieHeaderForRequest("http://example.com/api/foo")).toBe(
    "sid=api",
  );
  expect(getCookieHeaderForRequest("http://example.com/other")).toBe(
    "sid=root",
  );
});

test("selectCookieHeaderCandidates: redirect Set-Cookie beats jar; longer path wins within tier", () => {
  const header = selectCookieHeaderCandidates([
    { name: "sid", value: "root", path: "/", tier: 0, seq: 0 },
    { name: "sid", value: "api", path: "/api", tier: 0, seq: 1 },
    { name: "sid", value: "explicit", path: "", tier: 1, seq: 2 },
    { name: "sid", value: "redirect", path: "/", tier: 2, seq: 3 },
  ]);
  expect(header).toBe("sid=redirect");
});
