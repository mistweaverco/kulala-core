import type { KulalaError } from "./types/error";
import type {
  KulalaDirective,
  KulalaImportDirective,
  KulalaRunDirective,
} from "./types/directive";

/**
 * Parse an import directive: "import ./path/to/file.http"
 */
export function parseImportDirective(
  line: string,
  lineNumber: number,
): KulalaImportDirective | KulalaError {
  const trimmed = line.trim();
  if (!trimmed.startsWith("import")) {
    return {
      errorMessage: `Invalid import directive: ${trimmed}`,
      lineNumber,
    };
  }
  if (trimmed === "import") {
    return {
      errorMessage: `Invalid import directive: ${trimmed}. Import directive requires a file path`,
      lineNumber,
    };
  }
  const filepath = trimmed.slice(6).trim(); // "import".length = 6, then trim whitespace
  if (!filepath) {
    return {
      errorMessage: `Invalid import directive: ${trimmed}. Import directive requires a file path`,
      lineNumber,
    };
  }
  return {
    type: "import",
    filepath,
    lineNumber,
  };
}

/**
 * Parse a run directive: "run ./file.http" or "run #BLOCK_NAME" or "run #BLOCK_NAME (@var=value, @var2=value2)"
 */
export function parseRunDirective(
  line: string,
  lineNumber: number,
): KulalaRunDirective | KulalaError {
  const trimmed = line.trim();
  if (!trimmed.startsWith("run")) {
    return {
      errorMessage: `Invalid run directive: ${trimmed}`,
      lineNumber,
    };
  }
  if (trimmed === "run") {
    return {
      errorMessage: `Invalid run directive: ${trimmed}. Run directive requires a target (file path or block name)`,
      lineNumber,
    };
  }
  const rest = trimmed.slice(3).trim(); // "run".length = 3, then trim whitespace
  if (!rest) {
    return {
      errorMessage: `Invalid run directive: ${trimmed}. Run directive requires a target (file path or block name)`,
      lineNumber,
    };
  }

  // Check for variable overrides: (@var=value, @var2=value2)
  const overrideMatch = rest.match(/^(.+?)\s+\((.+)\)$/);
  let target: string;
  let variableOverrides: Record<string, string> | undefined;

  if (overrideMatch) {
    target = overrideMatch[1]!.trim();
    const overrideStr = overrideMatch[2]!.trim();
    variableOverrides = {};
    // Parse @var=value pairs separated by commas
    const pairs = overrideStr.split(",").map((p) => p.trim());
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) {
        return {
          errorMessage: `Invalid variable override format: ${pair}. Expected @var=value`,
          lineNumber,
        };
      }
      let varName = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      // Remove @ prefix if present
      if (varName.startsWith("@")) {
        varName = varName.slice(1);
      }
      if (!varName) {
        return {
          errorMessage: `Variable name cannot be empty in override: ${pair}`,
          lineNumber,
        };
      }
      variableOverrides[varName] = value;
    }
  } else {
    target = rest;
  }

  return {
    type: "run",
    target,
    variableOverrides,
    lineNumber,
  };
}

/**
 * Check if a line is a directive (import or run).
 */
export function isDirective(line: string): boolean {
  const trimmed = line.trim();
  return (
    (trimmed.startsWith("import") &&
      trimmed.length > 6 &&
      trimmed[6] === " ") ||
    (trimmed.startsWith("run") && trimmed.length > 3 && trimmed[3] === " ")
  );
}
