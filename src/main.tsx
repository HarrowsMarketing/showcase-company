import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installApiCache } from './lib/apiCache'
import { installMockApi } from './mocks/server'
import './index.css'

// This build has no real backend — every request is answered by a local mock
// (src/mocks/server.ts) with fabricated data, so nothing ever leaves the browser.
installMockApi()

// Clears the read cache whenever a save/mutation succeeds, so edits show immediately.
installApiCache()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
