import { ensureNonNull } from "./ensureNonNull";

export function getEnv(name: string): string {
  return ensureNonNull(process.env[name], name);
}
