import { migration000001Initial } from "./versions/000001_initial";

export type Migration = {
  version: number;
  name: string;
  statements: readonly string[];
};

/** Ordered migrations (definitions live under versions/). Append only; never reorder or edit applied migrations. */
export const MIGRATIONS: readonly Migration[] = [migration000001Initial];
