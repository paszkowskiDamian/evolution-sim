import { createRoot } from 'react-dom/client';
import App from './App';

// Świadomie bez <StrictMode>: podwójne montowanie w devie tworzyłoby
// dwie instancje kontekstu WebGL i dwie pętle symulacji.
const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root');
createRoot(root).render(<App />);
