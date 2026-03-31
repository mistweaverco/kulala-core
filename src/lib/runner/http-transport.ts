import type {
  NodeHttpClientOptions,
  NodeHttpClientResponse,
} from "./http-client";

export type KulalaHttpTransport = {
  request(options: NodeHttpClientOptions): Promise<NodeHttpClientResponse>;
};
