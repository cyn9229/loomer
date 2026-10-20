// Fixture preview for test prep: sidepanel.html?practice=<name> shows the
// practice view, ?prep=<name> the test's prep section. A picker switches
// fixtures. Actions only say they are a preview; nothing is sent.
import { useState } from 'react';
import { buildPracticeFixtures, buildPrepFixtures, type PracticeFixtureName, type PrepFixtureName } from '../../src/ui/prepFixtures';
import { PracticeView } from '../../src/ui/practice';
import { PrepSection } from '../../src/ui/prep';
import { Icon } from '../../src/ui/Icon';
import { SubjectTile } from '../../src/ui/parts';
import { useNow } from '../../src/ui/useNow';

export function PrepPreview({ practice, prep }: { practice: string | null; prep: string | null }) {
  const now = useNow();
  const practices = buildPracticeFixtures();
  const preps = buildPrepFixtures(now);
  const practiceNames = Object.keys(practices) as PracticeFixtureName[];
  const prepNames = Object.keys(preps) as PrepFixtureName[];
  const [pName, setPName] = useState<PracticeFixtureName | null>(practiceNames.find((n) => n === practice) ?? (prep === null ? 'mcq' : null));
  const [tName, setTName] = useState<PrepFixtureName | null>(prepNames.find((n) => n === prep) ?? null);
  const [note, setNote] = useState<string | null>(null);
  const say = (what: string) => () => setNote(`Preview only: ${what} was not sent.`);

  return (
    <>
      <div className="preview-picker">
        <label>
          Practice{' '}
          <select value={pName ?? ''} onChange={(e) => (setPName((e.target.value || null) as PracticeFixtureName | null), setTName(null))}>
            <option value="">none</option>
            {practiceNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          Test page{' '}
          <select value={tName ?? ''} onChange={(e) => (setTName((e.target.value || null) as PrepFixtureName | null), setPName(null))}>
            <option value="">none</option>
            {prepNames.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="preview-banner" role="note">
        {note ?? 'Fixture preview: test prep. Not live data.'}
      </p>
      {pName ? (
        <PracticeView
          key={pName}
          practice={practices[pName]}
          courseName={pName.startsWith('math') ? 'Algebra 2' : 'U.S. History'}
          onAnswer={(reply) => setNote(`Preview only: the answer ${JSON.stringify(reply)} was not sent.`)}
          onLike={say('Try one like it')}
          onNext={say('Next')}
          onEnd={say('End')}
          onReviewMistakes={say('Review mistakes')}
        />
      ) : tName ? (
        <div className="panel">
          <header className="bar">
            <button type="button" className="back">
              <Icon name="chevronLeft" />
              Back
            </button>
          </header>
          <div className="d-head">
            <SubjectTile courseName="U.S. History" size="lg" />
            <span className="d-class">
              <span>U.S. History</span> · Test
            </span>
          </div>
          <h1 className="d-title">Unit 5 Test: Imperialism</h1>
          <PrepSection
            prep={preps[tName]}
            actions={{
              onStart: say('Start practice'),
              onBuild: say('Build my plan'),
              onPracticeMistake: say('Practice this mistake'),
              onSetTime: (minutes) => setNote(`Preview only: ${minutes} minutes for today was not sent.`),
              onRemind: (sessionId, on) => setNote(`Preview only: the reminder for ${sessionId} (${on ? 'on' : 'off'}) was not sent.`),
              onEditTopics: (edit) => setNote(`Preview only: the topic change ${JSON.stringify(edit)} was not sent.`),
              onSetFormats: (formats) => setNote(`Preview only: the formats ${formats.join(', ')} were not sent.`),
              onAddNotes: (photos) => setNote(`Preview only: ${photos.length} photos were read but not sent.`),
              busy: false,
            }}
          />
        </div>
      ) : null}
    </>
  );
}
