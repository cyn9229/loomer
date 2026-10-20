// Teaching blocks (round 44, 4A): after a miss, or when a topic stays shaky,
// practice shows a short block as its own step, then a check on the same idea.
// The block starts from the student's exact answer and takes the form that
// fits the content: a compare table for case studies, a timeline for causes
// and order, an explanation that quotes the study guide or notes, a frame for
// building a free-response claim (blanks only, never the answer), or a simple
// picture. A second block on the same idea is always a different kind. Blocks
// are saved on the test's page, so the student can reread them before the test.
import { AiMark } from './aiBlock';
import { Icon } from './Icon';
import type { TeachBlock } from '../model/prep';

const LEAD: Record<TeachBlock['kind'], string> = {
  explain: 'Let’s fix this one',
  compare: 'Let’s fix this one',
  timeline: 'Let’s see how it happened',
  'frq-skill': 'A skill for the free response',
  visual: 'Another way to see it',
};

/** One teaching block, in practice or reread from the test's page. */
export function TeachBlockView({ block, lead = true }: { block: TeachBlock; lead?: boolean }) {
  return (
    <>
      {lead && (
        <p className="tb-lead">
          <Icon name={block.again ? 'repeat' : 'bulb'} size="sm" />
          {block.again ? 'Another way to see it' : LEAD[block.kind]}
        </p>
      )}
      {block.miss && (
        <p className="tb-miss">
          <Icon name="xCircle" />
          <span>{block.miss}</span>
        </p>
      )}
      <section className="tb" aria-label={block.title}>
        <p className="tb-k">
          <AiMark />
          {block.title}
        </p>
        {block.quote && (
          <blockquote className="tb-quote">
            “{block.quote.text}”<cite>{block.quote.source}</cite>
          </blockquote>
        )}
        {block.compare && (
          <table className="tb-table">
            <thead>
              <tr>
                <th />
                <th scope="col">{block.compare.heads[0]}</th>
                <th scope="col">{block.compare.heads[1]}</th>
              </tr>
            </thead>
            <tbody>
              {block.compare.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.a}</td>
                  <td>{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {block.steps && block.kind === 'visual' ? (
          <div className="tb-flow">
            {block.steps.map((st, i) => (
              <div key={i} className="tb-flow-step">
                {i > 0 && <Icon name="chevronDown" size="xs" />}
                <span className="tb-box">{st.text}</span>
              </div>
            ))}
          </div>
        ) : (
          block.steps && (
            <ol className="tb-steps">
              {block.steps.map((st, i) => (
                <li key={i}>
                  <b>{st.when}</b>
                  <span>{st.text}</span>
                </li>
              ))}
            </ol>
          )
        )}
        {block.frame && (
          <>
            <p className="tb-frame">
              {block.frame.map((part, i) =>
                typeof part === 'string' ? (
                  <span key={i}>{part}</span>
                ) : (
                  <u key={i} className="tb-blank">
                    {part.blank}
                  </u>
                ),
              )}
            </p>
            <p className="tb-note">Loomer won’t fill this in for you, because the claim needs to be yours.</p>
          </>
        )}
        {block.text && <p className="tb-text">{block.text}</p>}
      </section>
    </>
  );
}

/** Practice's teaching step: the block, then Check it (or Try it for a claim frame) moves to the check question. */
export function TeachStep({ block, onNext }: { block: TeachBlock; onNext: () => void }) {
  return (
    <>
      <div className="pv-body">
        <TeachBlockView block={block} />
      </div>
      <div className="pv-foot">
        <button type="button" className="btn-primary" onClick={onNext}>
          {block.kind === 'frq-skill' ? 'Try it' : 'Check it'}
          <Icon name="arrowRight" />
        </button>
      </div>
    </>
  );
}
