import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';
import { enableMocking } from './mocks/enableMocking';

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

async function bootstrap() {
  await enableMocking();
  renderApp();
}

void bootstrap();
