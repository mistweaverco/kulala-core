const cwd = process.cwd();
const tokenCache = client.global.get("tokenCache") || {};

if (tokenCache[cwd] && tokenCache[cwd].expiresAt > Date.now()) {
  client.log("Using cached token.");
  client.global.set("token", tokenCache[cwd].token);
} else {
  client.log("Token expired or not found. Requesting new token...");
  const res = await $kulala.runRequest("login", "./tokencache.http");
  if (res.status === 200) {
    const data = await res.body.json;
    tokenCache[cwd] = {
      token: data.token,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    client.global.set("tokenCache", tokenCache);
    client.global.set("token", tokenCache[cwd].token);
  } else {
    client.log("Failed to get token from login request.");
  }
}
