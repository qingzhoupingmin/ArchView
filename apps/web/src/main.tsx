import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { setSessionTeardown } from './auth/useAuthStore';
import i18n from './i18n';
import { idbPurgeNotMine, stopSaveEngine } from './save/saveService';
import { useAppStore } from './store/useAppStore';
import { useDocumentStore } from './store/useDocumentStore';
// 粉白主题 token（产品文档 §10.2）+ 全局样式
import '@archview/theme/tokens.css';
import './styles/global.css';

/**
 * 会话清理装配（数据隔离专项·批次 A/S2）。
 * 放在这里而不是 auth store 内部：这里是唯一能同时看到 auth / 业务 store / saveService
 * 的组装点，反向依赖由 useAuthStore.setSessionTeardown 的回调注册隔开（不成环）。
 */
setSessionTeardown(async (prevUserId) => {
  stopSaveEngine(); // ① 先停防抖：否则 400ms 后还会把旧工程写进缓冲
  useDocumentStore.getState().reset(); // ② 清内存里的工程数据 / projectId / 剪贴板
  useAppStore.getState().resetSessionScoped(); // ③ 清选择集与保存态
  await idbPurgeNotMine(prevUserId); // ④ 清掉不属于该账号的本地缓冲（本人的留给下次崩溃恢复）
});

// BrowserRouter：react-router v6 的 <Routes>/useNavigate 等必须运行在 Router 上下文中（SPA 深链由服务端回退 index.html，见 api main.ts）
// I18nextProvider：显式注入本应用初始化的 i18n 实例（T4.2 方案 B；不依赖全局单例的加载时序，英文启动时换语言只动这一层）
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nextProvider>
  </React.StrictMode>,
);

