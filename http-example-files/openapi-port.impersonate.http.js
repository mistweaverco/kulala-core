if (request.url.tryGetSubstituted().endsWith("/swagger/json")) {
  client.global.set("PORT_BEARER_TOKEN", "NONE");
  client.exit(0);
  return;
}

const { spawnSync } = require("node:child_process");

const isExcludedURL = (url) => {
  if (!url) return true;
  const excludedPatterns = [
    /^http:\/\/localhost/,
    /^http:\/\/\d{1,3}(\.\d{1,3}){3}/, // IPv4
    /^http:\/\/\[[0-9a-fA-F:]+\]/, // IPv6
  ];
  return excludedPatterns.some((pattern) => pattern.test(url));
};

if (isExcludedURL(request.url.tryGetSubstituted())) {
  client.global.set("PORT_BEARER_TOKEN", "NONE");
  return;
}

const TOKEN_TTL = 60 * 60; // 1 hour
const PORT_BEARER_TOKEN_RAW = client.global.get("PORT_BEARER_TOKEN_CACHE");
const PORT_BEARER_TOKEN = PORT_BEARER_TOKEN_RAW
  ? JSON.parse(PORT_BEARER_TOKEN_RAW)
  : null;

let RES;

// Check if we have a valid token cached
if (PORT_BEARER_TOKEN) {
  const now = Math.floor(Date.now() / 1000);
  if (now < PORT_BEARER_TOKEN.expiry) {
    // Use cached token
    // Set the token in global variable
    client.global.set("PORT_BEARER_TOKEN", PORT_BEARER_TOKEN.token);
    client.log("Using cached Bearer Token");
    client.log(
      "Token expires at: " +
        new Date(PORT_BEARER_TOKEN.expiry * 1000).toISOString(),
    );
    return;
  }
}

const whichPort = spawnSync("which", ["port"], {
  encoding: "utf-8",
});
if (whichPort.status !== 0) {
  client.log("Port CLI is not installed. Please install it to continue.");
  $kulala.request.abort();
  return;
}

// We need to get a new token
RES = spawnSync("port", ["auth", "token"], {
  encoding: "utf-8",
});

if (RES.error) {
  client.log(RES.error);
  $kulala.request.abort();
  return;
}

const TOKEN = RES.stdout.replace(/\n$/, "");
// Cache the token with its expiry time
const NOW = Math.floor(Date.now() / 1000);
PORT_BEARER_TOKEN.token = TOKEN;
// Subtract 60 seconds to account for clock skew, or use returned values from the shell out
PORT_BEARER_TOKEN.expiry = NOW + TOKEN_TTL - 60;

client.global.set("PORT_BEARER_TOKEN_CACHE", JSON.stringify(PORT_BEARER_TOKEN));

// Update the global cache
client.global.set("PORT_BEARER_TOKEN", TOKEN);
client.log(
  "Token expires at: " +
    new Date(PORT_BEARER_TOKEN.expiry * 1000).toISOString(),
);
