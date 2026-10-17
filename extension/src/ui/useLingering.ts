import { useEffect, useState } from 'react';

/**
 * Keeps the last non-null value on screen for `ms` after it becomes null, with
 * `leaving` set, so an element can fade out instead of vanishing.
 */
export function useLingering<T>(value: T | null, ms: number): { value: T | null; leaving: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      setKept(value);
      return;
    }
    const id = setTimeout(() => setKept(null), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return { value: value ?? kept, leaving: value === null && kept !== null };
}
