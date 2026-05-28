const CURRENT_ENV = request.environment.get("env_name") || "default";
const OP_ENTRY_NAME = `github-${CURRENT_ENV}`;
const GLOBAL_KEY_IN_REQUESTS = "GITHUB_CREDENTIALS_FROM_OP";
const CACHE_EXPIRES_IN_MINUTES = 30;

console.info("Currently running in: " + CURRENT_ENV);

const cache = client.global.get(GLOBAL_KEY_IN_REQUESTS);

if (cache && cache.expiresOnUnixTimestamp > Date.now()) {
  const minutesUntilExpire = Math.floor(
    (cache.expiresOnUnixTimestamp - Date.now()) / 1000 / 60,
  );
  const secondsUntilExpire = Math.floor(
    ((cache.expiresOnUnixTimestamp - Date.now()) / 1000) % 60,
  );
  if (cache.environment === CURRENT_ENV) {
    console.info(
      `Using cached credentials from global store. Expires in
      ${minutesUntilExpire} minute(s) and ${secondsUntilExpire} second(s).`,
    );
    return;
  } else {
    console.info(
      `Cached credentials is for environment "${cache.environment}",
      but current environment is "${CURRENT_ENV}". Fetching from 1Password CLI...`,
    );
    client.global.set(GLOBAL_KEY_IN_REQUESTS, null);
  }
} else {
  console.info(
    "No valid cached credentials found. Fetching from 1Password CLI...",
  );
}

const result = spawnSync(
  "op",
  ["item", "get", `${OP_ENTRY_NAME}`, "--format", "json"],
  {
    encoding: "utf-8",
  },
);

const errors = [];

if (result.status !== 0) {
  errors.push(`1Password CLI exited with code ${result.status}`);
}

if (result.error) {
  errors.push(result.error.message);
}

if (result.stderr && result.stderr.trim().length > 0) {
  errors.push(result.stderr.trim());
}

if (errors.length > 0) {
  console.error("Error fetching credentials from 1Password");
  const allErrors = errors.join("\n");
  throw new Error(allErrors);
} else {
  // map fields to an object for easier access
  // assuming the OP entry has fields with ids "username" and "password"
  const githubCredentialsFromOP = JSON.parse(
    result.stdout.trim(),
  ).fields.reduce((acc, field) => {
    acc[field.id] = field.value;
    return acc;
  }, {});
  const username = githubCredentialsFromOP.username;
  const password = githubCredentialsFromOP.password;
  const cacheExpiresInSeconds = CACHE_EXPIRES_IN_MINUTES * 60;
  client.global.set(GLOBAL_KEY_IN_REQUESTS, {
    environment: CURRENT_ENV,
    username,
    password,
    expiresOnUnixTimestamp: Date.now() + cacheExpiresInSeconds * 1000,
  });
  // Store the credentials in an environment variable for use in subsequent steps
  console.info(
    `Credentials fetched from 1Password and stored in global cache.
    Expires in ${CACHE_EXPIRES_IN_MINUTES} minute(s).`,
  );
}
