import { expect, test } from "bun:test";
import { getHeader } from "./header";

test("getHeader: unescapes braces in header values", () => {
  // When content comes from JSON stdin, braces are escaped as \{ and \}
  const header = getHeader(
    'Authorization: Bearer \\{\\{$auth.token("my-auth")\\}\\}',
    0,
  );
  expect(header).toEqual({
    name: "Authorization",
    value: 'Bearer {{$auth.token("my-auth")}}',
  });
});

test("getHeader: handles normal headers without escaping", () => {
  const header = getHeader("Content-Type: application/json", 0);
  expect(header).toEqual({
    name: "Content-Type",
    value: "application/json",
  });
});

test("getHeader: handles headers with escaped braces in middle", () => {
  const header = getHeader("X-Custom: prefix \\{value\\} suffix", 0);
  expect(header).toEqual({
    name: "X-Custom",
    value: "prefix {value} suffix",
  });
});
