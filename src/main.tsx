import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel-decorative/400.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/libre-baskerville/400.css';
import '@fontsource/libre-baskerville/400-italic.css';
import '@fontsource/libre-baskerville/700.css';
// Rye (Sorkin Type, SIL Open Font License 1.1): the title logotype. Self-hosted; see public/licenses.
import '@fontsource/rye/latin-400.css';
import './styles/base.css';
import './styles/theme.css';
import './styles/game.css';
import './styles/dusthex.css';
import './styles/shop.css';
import './styles/title.css';
import './styles/coins.css';
import './styles/fx.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
