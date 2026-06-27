function urlEncode(str: string, skip: string): string {
  const normalized = str.replace(/\n/g, "\r\n");
  let result = "";
  for (const char of normalized) {
    if (/[\w.\-_~]/.test(char) || skip.includes(char)) {
      result += char;
    } else {
      result += `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return result;
}

function urlEncodeSkipEncoded(str: string, skip: string): string {
  let result = "";
  let remaining = str;
  while (remaining.length > 0) {
    const match = remaining.match(/%[0-9A-Fa-f]{2}/);
    if (match && match.index !== undefined) {
      result += urlEncode(remaining.slice(0, match.index), skip);
      result += match[0];
      remaining = remaining.slice(match.index + 3);
    } else {
      result += urlEncode(remaining, skip);
      break;
    }
  }
  return result;
}

/**
 * Split `?query#fragment` from the path suffix. `#` inside query values (e.g.
 * `?name=@#$x&y=1`) stays in the query; only a trailing `#fragment` without
 * `&` after the hash is treated as a URI fragment.
 */
function splitQueryAndFragment(pathSuffix: string): {
  path: string;
  query: string;
  fragment: string;
} {
  const qIdx = pathSuffix.indexOf("?");
  if (qIdx === -1) {
    const hashIdx = pathSuffix.indexOf("#");
    if (hashIdx === -1) {
      return { path: pathSuffix, query: "", fragment: "" };
    }
    return {
      path: pathSuffix.slice(0, hashIdx),
      query: "",
      fragment: pathSuffix.slice(hashIdx),
    };
  }

  const queryStart = qIdx;
  const afterQuestion = pathSuffix.slice(qIdx + 1);
  let fragmentStart = -1;
  for (let i = 0; i < afterQuestion.length; i++) {
    if (afterQuestion[i] !== "#") continue;
    const afterHash = afterQuestion.slice(i + 1);
    if (!afterHash.includes("&")) {
      fragmentStart = qIdx + 1 + i;
      break;
    }
  }

  if (fragmentStart === -1) {
    return {
      path: pathSuffix.slice(0, queryStart),
      query: pathSuffix.slice(queryStart),
      fragment: "",
    };
  }

  return {
    path: pathSuffix.slice(0, queryStart),
    query: pathSuffix.slice(queryStart, fragmentStart),
    fragment: pathSuffix.slice(fragmentStart),
  };
}

/**
 * JetBrains-style request URL encoding (enabled unless @no-auto-encoding).
 */
export function encodeRequestUrl(url: string, method?: string): string {
  const methodUpper = (method ?? "GET").toUpperCase();
  if (methodUpper === "GRPC") {
    return url;
  }

  const encode = urlEncodeSkipEncoded;
  let rest = url;
  let scheme = "";

  const schemeSep = rest.indexOf("://");
  if (schemeSep !== -1) {
    scheme = encode(rest.slice(0, schemeSep), "+") + "://";
    rest = rest.slice(schemeSep + 3);
  }

  const slashIdx = rest.indexOf("/");
  let authority = "";
  let pathSuffix = "";
  if (slashIdx === -1) {
    authority = encode(rest, "@:[]");
  } else {
    authority = encode(rest.slice(0, slashIdx), "@:[]");
    pathSuffix = rest.slice(slashIdx);
  }

  const { path, query, fragment } = splitQueryAndFragment(pathSuffix);

  return (
    scheme +
    authority +
    encode(path, "/:;=[]%()!$',*") +
    (query ? encode(query, "%?=&%()!',*") : "") +
    (fragment ? encode(fragment, "#/%()!$',*") : "")
  );
}
