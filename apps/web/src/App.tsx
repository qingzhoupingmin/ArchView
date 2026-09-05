import { type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStore } from './auth/useAuthStore';
import { usePermission } from './auth/usePermission';
import { PERMISSIONS } from '@archview/core';
import Toasts from './components/Toasts';
import AdminPage from './pages/AdminPage';
import FpsBaselinePage from './pages/FpsBaselinePage';
import LoginPage from './pages/LoginPage';
import ProfilePage from './pages/ProfilePage';
import ProjectPage from './pages/ProjectPage';
import ProjectsPage from './pages/ProjectsPage';

/**
 * 路由（T1.1）：/login 登录页 · / 工程列表 · /project/:id 建模主应用 · /admin 管理中心 · /profile 个人中心 · /fps 性能基线（S2.0d，开发工具免登录）。
 * 路由守卫：未登录 → /login（携带 redirect 回跳参数，登录后回原页面）。
 */
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 性能基线采样页（S2.0d / T3.6）：开发工具，免登录；入口 pnpm fps */}
        <Route path="/fps" element={<FpsBaselinePage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ProjectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/project/:id"
          element={
            <RequireAuth>
              <ProjectPage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth>
              <AdminGate>
                <AdminPage />
              </AdminGate>
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </>
  );
}

/** 登录守卫：未登录跳 /login 并记住来源路径（redirect 回跳） */
function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/** 超管入口守卫（FR-U06 按钮级权限同源的页面级守卫）：无 USER_MANAGE 权限显示提示卡 */
function AdminGate({ children }: { children: ReactNode }) {
  const can = usePermission();
  if (!can(PERMISSIONS.USER_MANAGE)) {
    return (
      <div className="center-page">
        <div className="center-card">
          <h2>需要超管权限</h2>
          <p className="muted">「管理中心」仅超级管理员可见（FR-U06）</p>
          <p>
            <Link to="/">← 返回工程列表</Link>
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
