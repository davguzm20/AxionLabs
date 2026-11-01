import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layout/AppShell';
import { LoginPage } from '../features/auth/LoginPage';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { RegisterPage } from '../features/auth/RegisterPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { ChatPage } from '../features/chat/ChatPage';
import { ClassificationPage } from '../features/classification/pages/ClassificationPage';
import { WalletsPage } from '../features/wallets/pages/WalletsPage';
import { BudgetsPage } from '../features/budgets/pages/BudgetsPage';
import { BudgetFormPage } from '../features/budgets/pages/BudgetFormPage';
import { SettingsPage } from '../features/settings/pages/SettingsPage';
import { NotificationsPage } from '../features/notifications/pages/NotificationsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/inicio" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro" element={<RegisterPage />} />
      <Route path="/recuperar-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/inicio" element={<ChatPage />} />
          <Route path="/clasificar" element={<ClassificationPage />} />
          <Route path="/historial" element={<PlaceholderPage title="Historial" />} />
          <Route path="/presupuestos" element={<BudgetsPage />} />
          <Route path="/presupuestos/nuevo" element={<BudgetFormPage />} />
          <Route path="/presupuestos/:budgetId/editar" element={<BudgetFormPage />} />
          <Route path="/monederos" element={<WalletsPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="/notificaciones" element={<NotificationsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
