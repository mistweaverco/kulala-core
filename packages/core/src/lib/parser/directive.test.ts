import { expect, test } from "bun:test";
import {
  parseImportDirective,
  parseRunDirective,
  isDirective,
} from "./directive";

test("parseImportDirective: valid import", () => {
  const result = parseImportDirective("import ./file.http", 0);
  expect(result).toEqual({
    type: "import",
    filepath: "./file.http",
    lineNumber: 0,
  });
});

test("parseImportDirective: import with path", () => {
  const result = parseImportDirective("import ./myFolder/get-requests.http", 5);
  expect(result).toEqual({
    type: "import",
    filepath: "./myFolder/get-requests.http",
    lineNumber: 5,
  });
});

test("parseImportDirective: invalid - missing path", () => {
  const result = parseImportDirective("import ", 0);
  expect(result).toHaveProperty("errorMessage");
  if ("errorMessage" in result) {
    expect(result.errorMessage).toMatch(/requires.*file path/i);
  }
});

test("parseRunDirective: run file", () => {
  const result = parseRunDirective("run ./file.http", 0);
  expect(result).toEqual({
    type: "run",
    target: "./file.http",
    lineNumber: 0,
  });
});

test("parseRunDirective: run block by name", () => {
  const result = parseRunDirective("run #BLOCK_NAME", 0);
  expect(result).toEqual({
    type: "run",
    target: "#BLOCK_NAME",
    lineNumber: 0,
  });
});

test("parseRunDirective: run block with single variable override", () => {
  const result = parseRunDirective("run #BLOCK_NAME (@host=example.com)", 0);
  expect(result).toEqual({
    type: "run",
    target: "#BLOCK_NAME",
    variableOverrides: { host: "example.com" },
    lineNumber: 0,
  });
});

test("parseRunDirective: run block with multiple variable overrides", () => {
  const result = parseRunDirective(
    "run #BLOCK_NAME (@host=example.com, @user=userName)",
    0,
  );
  expect(result).toEqual({
    type: "run",
    target: "#BLOCK_NAME",
    variableOverrides: { host: "example.com", user: "userName" },
    lineNumber: 0,
  });
});

test("parseRunDirective: variable override without @ prefix", () => {
  const result = parseRunDirective("run #BLOCK_NAME (host=example.com)", 0);
  expect(result).toEqual({
    type: "run",
    target: "#BLOCK_NAME",
    variableOverrides: { host: "example.com" },
    lineNumber: 0,
  });
});

test("parseRunDirective: invalid - missing target", () => {
  const result = parseRunDirective("run ", 0);
  expect(result).toHaveProperty("errorMessage");
  if ("errorMessage" in result) {
    expect(result.errorMessage).toMatch(/requires.*target/i);
  }
});

test("parseRunDirective: invalid override format", () => {
  const result = parseRunDirective("run #BLOCK_NAME (invalid)", 0);
  expect(result).toHaveProperty("errorMessage");
  if ("errorMessage" in result) {
    expect(result.errorMessage).toContain("Invalid variable override format");
  }
});

test("isDirective: detects import", () => {
  expect(isDirective("import ./file.http")).toBe(true);
  expect(isDirective("  import ./file.http  ")).toBe(true);
  expect(isDirective("import")).toBe(false);
  expect(isDirective("not an import")).toBe(false);
});

test("isDirective: detects run", () => {
  expect(isDirective("run ./file.http")).toBe(true);
  expect(isDirective("run #BLOCK_NAME")).toBe(true);
  expect(isDirective("  run #BLOCK  ")).toBe(true);
  expect(isDirective("run")).toBe(false);
  expect(isDirective("not a run")).toBe(false);
});
