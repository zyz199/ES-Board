import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from '@lingui/react'
import i18n, { detectLocale, setLocale } from './i18n'
import './index.css'

setLocale(detectLocale())

// 注意：不加 React.StrictMode。
// StrictMode 在开发模式下会把每个 useEffect「挂载→卸载→再挂载」执行两次，
// 会导致更新检查等副作用触发两次（弹窗弹两条、请求发两次）。
// 桌面应用（Wails）无浏览器扩展开发场景，保持与 Vue 版一致的单次执行行为。
// index.html 里固定有 id="app" 的挂载点，这里非空断言
ReactDOM.createRoot(document.getElementById('app')!).render(
  <I18nProvider i18n={i18n}>
    <App />
  </I18nProvider>,
)
