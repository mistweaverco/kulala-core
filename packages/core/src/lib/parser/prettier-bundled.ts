import * as prettier from "prettier/standalone";
import type { Plugin } from "prettier";
import * as prettierPluginGraphql from "prettier/plugins/graphql";
import * as prettierPluginEstree from "prettier/plugins/estree";
import * as prettierPluginBabel from "prettier/plugins/babel";
import * as prettierPluginHtml from "prettier/plugins/html";

/** Plugins required for JSON and GraphQL body formatting in standalone builds. */
const bundledPrettierPlugins = [
  prettierPluginGraphql,
  prettierPluginEstree,
  prettierPluginBabel,
  prettierPluginHtml,
] as Plugin[];

export type BundledPrettierParser = "json" | "graphql" | "html" | "babel";

export type BundledPrettierOptions = {
  tabWidth?: number;
  printWidth?: number;
  useTabs?: boolean;
};

export async function formatWithBundledPrettier(
  content: string,
  parser: BundledPrettierParser,
  options: BundledPrettierOptions = {},
): Promise<string> {
  return (
    await prettier.format(content, {
      parser,
      plugins: bundledPrettierPlugins,
      tabWidth: options.tabWidth ?? 2,
      printWidth: options.printWidth ?? 80,
      useTabs: options.useTabs ?? false,
    })
  ).trim();
}
