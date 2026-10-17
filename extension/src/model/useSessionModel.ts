// React hook for the work-session screen. Logic owns this file.
// M3 in progress: returns { status: 'none' } until session logic lands.
import type { SessionModel } from './session';

export function useSessionModel(): SessionModel | undefined {
  return { status: 'none' };
}
