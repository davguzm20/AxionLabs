import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { API_BASE_URL } from './lib/api';
import { worker } from './mocks/browser';
import './styles/globals.css';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

const mocksEnabled = import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== 'false';

if (mocksEnabled) {
  worker.start({ onUnhandledRequest: 'bypass' }).then(renderApp);
} else {
  console.info(`Usando backend real: ${API_BASE_URL}`);
  renderApp();
}
