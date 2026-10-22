import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App';
import { DEMO } from './api';
import './styles.css';
const Router = DEMO ? HashRouter : BrowserRouter;
createRoot(document.getElementById('root')!).render(<Router><App /></Router>);
