import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { worker } from './mocks/browser';
import './styles/globals.css';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

if (import.meta.env.DEV) {
  worker.start({ onUnhandledRequest: 'bypass' }).then(renderApp);
} else {
  renderApp();
}
