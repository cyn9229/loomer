import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder until a side-panel layout is picked from the mocks.
function SidePanel() {
  return <h1>loomer</h1>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
