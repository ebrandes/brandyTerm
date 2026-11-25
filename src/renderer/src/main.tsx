import { createRoot } from 'react-dom/client'
import { App } from './App'
import { api } from './api'
import './styles.css'

document.documentElement.dataset.platform = api.platform ?? 'win32'
createRoot(document.getElementById('root')!).render(<App />)
