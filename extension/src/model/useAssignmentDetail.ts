// React hook for the assignment detail screen. The live query reads only Dexie.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../core/db';
import { aiSettingsItem } from '../core/settings';
import { loadAssignmentDetail } from '../session/detail';
import type { AssignmentDetailModel } from './detail';
import { useStorageItem } from './useStorageItem';

const TICK_MS = 15_000;

export function useAssignmentDetail(assignmentId: string | null): AssignmentDetailModel | undefined {
  const ai = useStorageItem(aiSettingsItem);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return useLiveQuery(
    () => (ai && assignmentId ? loadAssignmentDetail(db, ai, assignmentId, new Date()) : undefined),
    [ai, assignmentId, tick],
  );
}
