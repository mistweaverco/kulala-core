import { expect, test } from "bun:test";
import { encodeRequestUrl } from "./encode-url";

test("encodeRequestUrl encodes special characters in query parameters", () => {
  expect(
    encodeRequestUrl(
      "https://echo.kulala.app/get?name=@#$somebody&qwerty=%40%23%24",
    ),
  ).toBe("https://echo.kulala.app/get?name=%40%23%24somebody&qwerty=%40%23%24");
});

test("encodeRequestUrl preserves already-encoded query sequences", () => {
  expect(encodeRequestUrl("https://example.com/?a=%2F&b=hello")).toBe(
    "https://example.com/?a=%2F&b=hello",
  );
});

test("encodeRequestUrl encodes unencoded slashes in query values", () => {
  expect(encodeRequestUrl("https://example.com/?path=a/b")).toBe(
    "https://example.com/?path=a%2Fb",
  );
});

test("encodeRequestUrl encodes path segments", () => {
  expect(encodeRequestUrl("https://example.com/a b/c@d")).toBe(
    "https://example.com/a%20b/c%40d",
  );
});

test("encodeRequestUrl encodes fragment", () => {
  expect(encodeRequestUrl("https://example.com/page#section @1")).toBe(
    "https://example.com/page#section%20%401",
  );
});

test("encodeRequestUrl splits trailing fragment from query", () => {
  expect(encodeRequestUrl("https://example.com/page?foo=bar#section")).toBe(
    "https://example.com/page?foo=bar#section",
  );
});

test("encodeRequestUrl skips GRPC targets", () => {
  expect(
    encodeRequestUrl("grpc.postman-echo.com:443 HelloService/SayHello", "GRPC"),
  ).toBe("grpc.postman-echo.com:443 HelloService/SayHello");
});

test("encodeRequestUrl leaves structural URL characters intact", () => {
  expect(encodeRequestUrl("https://user:pass@host:8080/path?k=v&x=1")).toBe(
    "https://user:pass@host:8080/path?k=v&x=1",
  );
});
