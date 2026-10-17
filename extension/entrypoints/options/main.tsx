import '../../src/ui/styles.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

// ?fixture=new|connected renders a labeled preview instead of live settings.
async function main() {
  const fixture = new URLSearchParams(location.search).get('fixture');
  let app: ReactNode;
  if (fixture !== null) {
    const { PreviewOptions } = await import('./preview');
    app = <PreviewOptions initial={fixture} />;
  } else {
    const { LiveOptions } = await import('./live');
    app = <LiveOptions />;
  }
  createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>);
}

void main();
