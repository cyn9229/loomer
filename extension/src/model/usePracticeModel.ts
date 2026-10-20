// React hook for the practice view. All decisions live in loadPracticeModel.
// Null when no practice is open; the answer key never reaches the page before an answer.
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../core/db';
import { loadPracticeModel } from '../prep/prep';
import type { Practice } from './prep';

export function usePracticeModel(): Practice | null | undefined {
  return useLiveQuery(() => loadPracticeModel(db, new Date()), []);
}
