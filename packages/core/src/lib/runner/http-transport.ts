import type { HttpRequestOptions, HttpRequestResponse } from "./http-client";

export type KulalaHttpTransport = {
  request(options: HttpRequestOptions): Promise<HttpRequestResponse>;
};
