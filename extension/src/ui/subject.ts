// Picks a subject icon from a class name, so every class gets a recognizable
// glyph without colors. Pure keyword matching, first rule wins; English comes
// before world languages so "AP English Language" is a book, not a translation.
import type { IconName } from './Icon';

const rules: [RegExp, IconName][] = [
  [/english|literature|writing|composition|reading|journalism/i, 'book'],
  [/history|government|civics|economics|geography|psychology|sociology|social studies/i, 'landmark'],
  [/chem/i, 'flask'],
  [/physics/i, 'atom'],
  [/environment|earth|ecology/i, 'tree'],
  [/bio|anatomy|life science/i, 'leaf'],
  [/math|algebra|geometry|calc|statistic|trig/i, 'sigma'],
  [/spanish|french|german|chinese|mandarin|japanese|latin|italian|korean|language/i, 'languages'],
  [/computer|programming|coding|\bcsp?\b/i, 'code'],
  [/\bart\b|drawing|painting|design|studio|ceramics|photo/i, 'palette'],
  [/music|band|choir|orchestra/i, 'music'],
  [/health|wellness|physical education|\bp\.?e\.?\b|fitness/i, 'heartPulse'],
  [/advisory|homeroom|seminar/i, 'users'],
];

export function subjectIcon(courseName: string | null): IconName {
  if (!courseName) return 'subjectDoc';
  return rules.find(([pattern]) => pattern.test(courseName))?.[1] ?? 'subjectDoc';
}
