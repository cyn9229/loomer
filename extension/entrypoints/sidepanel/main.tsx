import '../../src/ui/styles.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

// ?fixture=<name> renders a labeled fixture instead of live data, for visual
// review. Both modes load lazily so a preview never touches the live store.
async function main() {
  const fixture = new URLSearchParams(location.search).get('fixture');
  let app: ReactNode;
  if (fixture !== null) {
    const { PreviewPanel } = await import('./preview');
    app = <PreviewPanel initial={fixture} />;
  } else {
    const { LivePanel } = await import('./live');
    app = <LivePanel />;
  }
  createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
}

void main();
