import type { Database } from "bun:sqlite";
import {
  dedupeCookieJarDefaultPorts,
  ensureCookieJarCoalesceUniqueIndex,
} from "../cookie-jar-dedupe";

/**
 * SQLite treats NULL as distinct in UNIQUE(domain, port, path, name), so default-port
 * cookies (port NULL) never upserted and duplicates accumulated. Normalize NULL to 0
 * and add a COALESCE(port, 0) unique index for correct upserts going forward.
 */
export const migration000004CookieJarDefaultPort = {
  version: 4,
  name: "cookie_jar_default_port",
  statements: [] as const,
  apply(db: Database): void {
    dedupeCookieJarDefaultPorts(db);
    ensureCookieJarCoalesceUniqueIndex(db);
  },
} as const;
