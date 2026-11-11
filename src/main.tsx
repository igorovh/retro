import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { installLogTools } from './log';

installLogTools();
createRoot(document.getElementById('root')!).render(<App />);
