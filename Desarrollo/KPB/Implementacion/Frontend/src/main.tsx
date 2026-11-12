import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { API_BASE_URL } from './lib/api';
import './styles/globals.css';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

console.info(`Usando backend real: ${API_BASE_URL}`);
renderApp();
