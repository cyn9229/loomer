import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Placeholder for onboarding and Privacy & controls until a layout is picked.
function Options() {
  return <h1>loomer settings</h1>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
