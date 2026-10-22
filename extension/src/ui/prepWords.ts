// The Start button's words for each kind of test prep session, shared by
// Home's step and the test's page. Kept apart from prep.tsx so Home loads
// without the test prep screens, which load when a test's page opens.
import type { PrepSessionKind } from '../model/prep';

export const START_WORDS: Record<PrepSessionKind, string> = {
  diagnostic: 'Start the diagnostic',
  focus: 'Start practice',
  'mixed-check': 'Start the mixed check',
  'practice-test': 'Start the practice test',
  review: 'Start review',
  'warm-up': 'Start warm-up',
  rescue: 'Start the rescue',
};
