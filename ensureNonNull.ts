export function ensureNonNull<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(`null or undefined is found where non-null is expected: ${message}`);
  }

  return value;
}
