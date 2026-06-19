const CURRENT_ENV = request.environment.get("env_name") || "default";
const PATH_TO_KEEPASSXC_DB = "kulala.kdbx";
const KEEPASS_XC_ENTRY_NAME = `github-${CURRENT_ENV}`;
const GLOBAL_KEY_IN_REQUESTS = "GITHUB_CREDENTIALS";
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
      but current environment is "${CURRENT_ENV}". Fetching from KeePassXC CLI...`,
    );
    client.global.set(GLOBAL_KEY_IN_REQUESTS, null);
  }
} else {
  console.info(
    "No valid cached credentials found. Fetching from KeePassXC CLI...",
  );
}

// INFO: Password is
// 'Kulala is family'
// without the single quotes.
const KEEPASS_XC_PASSWORD_FROM_PROMPT = $kulala.prompt(
  "Password for KeePassXC database",
  "keepassxc_password",
  { type: "password" },
);

const result = spawnSync(
  "keepassxc-cli",
  [
    "show",
    "-q",
    PATH_TO_KEEPASSXC_DB,
    `${KEEPASS_XC_ENTRY_NAME}`,
    "-a",
    "username",
    "-a",
    "password",
  ],
  {
    input: KEEPASS_XC_PASSWORD_FROM_PROMPT + "\n",
    encoding: "utf-8",
  },
);

const errors = [];

if (result.status !== 0) {
  errors.push(`KeePassXC CLI exited with code ${result.status}`);
}

if (result.error) {
  errors.push(result.error.message);
}

if (result.stderr && result.stderr.trim().length > 0) {
  errors.push(result.stderr.trim());
}

if (errors.length > 0) {
  console.error("Error fetching credentials from KeePassXC");
  const allErrors = errors.join("\n");
  throw new Error(allErrors);
} else {
  const githubCredentialsFromKeepassXC = result.stdout.trim().split("\n");
  const username = githubCredentialsFromKeepassXC[0];
  const password = githubCredentialsFromKeepassXC[1];
  const cacheExpiresInSeconds = CACHE_EXPIRES_IN_MINUTES * 60;
  client.global.set(GLOBAL_KEY_IN_REQUESTS, {
    environment: CURRENT_ENV,
    username,
    password,
    expiresOnUnixTimestamp: Date.now() + cacheExpiresInSeconds * 1000,
  });
  // Store the credentials in an environment variable for use in subsequent steps
  console.info(
    `Credentials fetched from KeePassXC and stored in global cache.
    Expires in ${CACHE_EXPIRES_IN_MINUTES} minute(s).`,
  );
}
