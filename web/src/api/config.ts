const base: string = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/**
 * Builds an absolute API URL from a path.
 *
 * @param path - Path starting with `/`.
 * @returns The absolute URL.
 */
export function apiUrl(path: string): string {
  return `${base}${path}`;
}
