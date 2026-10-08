import { html } from 'hono/html'

export interface IndexConfig {
  version?: string
  appUrl?: string
}

export default (config: IndexConfig) => {
  return html`
    <!DOCTYPE html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>ReadReddit Server</title>
      </head>
      <body
        style="display: flex; justify-content: center; align-items: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
      >
        <div style="text-align: center;">
          <h1 style="font-size: 2rem; margin-bottom: 1rem;">ReadReddit Server</h1>
          <p style="font-size: 1.25rem; color: #6b7280;">Version: v${config.version || '0.0.0'}</p>
          <p style="font-size: 1rem; color: #9ca3af; margin-top: 0.5rem;">APP_URL: ${config.appUrl || process.env.PUBLIC_ORIGIN || process.env.APP_URL || 'http://localhost:3000'}</p>
        </div>
      </body>
    </html>
  `
}
