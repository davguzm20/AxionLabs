import { resetBudgetMocks, resetNotificationMocks } from '../mocks/handlers';

/** Aísla el estado persistido y mutable que comparten las pruebas del Frontend. */
export function resetFrontendState(): void {
  window.localStorage.clear();
  resetBudgetMocks();
  resetNotificationMocks();
}
