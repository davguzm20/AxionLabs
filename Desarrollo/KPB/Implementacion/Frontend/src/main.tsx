import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
<<<<<<< HEAD
import { API_BASE_URL } from './lib/api';
=======
import { worker } from './mocks/browser';
>>>>>>> caebe09528c7c132d63934ec4c8ca07dfcf9226a
import './styles/globals.css';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

<<<<<<< HEAD
console.info(`Usando backend real: ${API_BASE_URL}`);
renderApp();
=======
if (import.meta.env.DEV) {
  worker.start({ onUnhandledRequest: 'bypass' }).then(renderApp);
} else {
  renderApp();
}
>>>>>>> caebe09528c7c132d63934ec4c8ca07dfcf9226a
