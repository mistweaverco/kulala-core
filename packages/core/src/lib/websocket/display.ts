export type WsStreamMessage = { direction: "in" | "out"; data: string };

export function wsMessagePayloads(messages: WsStreamMessage[]): string[] {
  return messages.map((m) => m.data);
}

export function formatWsDisplayStream(messages: WsStreamMessage[]): string {
  if (!messages.length) return "";
  return messages
    .map(
      ({ direction, data }) => `${direction === "in" ? "<--" : "-->"} ${data}`,
    )
    .join("\n");
}

/** Strip trailing newline added for wire transport before recording sent payloads. */
export function normalizeSentPayload(data: string): string {
  return data.replace(/\n$/, "");
}
