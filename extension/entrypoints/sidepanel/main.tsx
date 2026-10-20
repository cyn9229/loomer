import '../../src/ui/styles.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

// ?fixture=<home>&session=<session> renders labeled fixtures instead of live data, for visual
// review; ?practice=<name> or ?prep=<name> shows test prep fixtures. Both modes load lazily so a preview never touches the live store.
async function main() {
  const params = new URLSearchParams(location.search);
  const fixture = params.get('fixture');
  let app: ReactNode;
  if (params.has('practice') || params.has('prep')) {
    const { PrepPreview } = await import('./prepPreview');
    app = <PrepPreview practice={params.get('practice')} prep={params.get('prep')} />;
  } else if (fixture !== null) {
    const { PreviewPanel } = await import('./preview');
    app = <PreviewPanel initial={fixture} initialSession={params.get('session')} />;
  } else {
    const { LivePanel } = await import('./live');
    app = <LivePanel />;
  }
  createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
}

void main();
