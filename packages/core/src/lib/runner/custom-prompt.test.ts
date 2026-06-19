import { describe, expect, test } from "bun:test";
import { parseKulalaPromptOperatorArgs } from "./custom-prompt";

describe("parseKulalaPromptOperatorArgs", () => {
  test("parses bare variable name", () => {
    expect(parseKulalaPromptOperatorArgs("TOKEN")).toEqual({
      varName: "TOKEN",
    });
  });

  test("parses unquoted label and variable name", () => {
    expect(parseKulalaPromptOperatorArgs("What is your name? NAME")).toEqual({
      varName: "NAME",
      label: "What is your name?",
    });
  });

  test("parses quoted label and variable name", () => {
    expect(parseKulalaPromptOperatorArgs(`"What is your name?" NAME`)).toEqual({
      varName: "NAME",
      label: "What is your name?",
    });
  });

  test("parses quoted label with password type option", () => {
    expect(
      parseKulalaPromptOperatorArgs(
        `"What is your prompt?" MY_VAR_NAME_PROMPT { type: "password" }`,
      ),
    ).toEqual({
      varName: "MY_VAR_NAME_PROMPT",
      label: "What is your prompt?",
      inputType: "password",
    });
  });

  test("parses text type option", () => {
    expect(
      parseKulalaPromptOperatorArgs(
        `"What is your prompt?" MY_VAR { type: "text" }`,
      ),
    ).toEqual({
      varName: "MY_VAR",
      label: "What is your prompt?",
      inputType: "text",
    });
  });

  test("parses url type option with single quotes", () => {
    expect(parseKulalaPromptOperatorArgs(`TOKEN { type: 'url' }`)).toEqual({
      varName: "TOKEN",
      inputType: "url",
    });
  });

  test("ignores unknown type suffix", () => {
    expect(parseKulalaPromptOperatorArgs(`NAME { type: "email" }`)).toEqual({
      varName: "NAME",
    });
  });
});
