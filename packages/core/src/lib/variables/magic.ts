/**
 * Dynamic variables per JetBrains HTTP Client spec.
 * https://www.jetbrains.com/help/idea/http-client-variables.html#dynamic-variables
 * Generated fresh per request. Optional spaces around braces kept: {{ $uuid }}.
 */
export function getMagicVariables(): Record<string, string> {
  const uuid = crypto.randomUUID();
  const now = Date.now();
  return {
    $uuid: uuid,
    "$random.uuid": uuid,
    $timestamp: String(now),
    $isoTimestamp: new Date(now).toISOString(), // ISO-8601 UTC
    $date: new Date(now).toISOString().slice(0, 10), // yyyy-mm-dd
    $randomInt: String(Math.floor(Math.random() * 1001)), // 0..1000 per JetBrains spec
  };
}
