/** Generates a random ID with an optional prefix */
export function generateId(prefix?: string): string {
  const id = Math.random().toString(36).substring(2, 15);
  return prefix ? `${prefix}-${id}` : id;
}
