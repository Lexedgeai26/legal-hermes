import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $route, $bootstrap, initialize } from './store'
import Welcome from './routes/welcome'
import Privacy from './routes/privacy'
import Analysis from './routes/analysis'
import Progress from './routes/progress'
import Success from './routes/success'
import Failure from './routes/failure'

/*
 * App shell — LexEdge Hermes Agent Setup.
 *
 * No header chrome (the OS title bar already says "LexEdge Hermes Agent Setup"; an
 * in-window repeat of the H mark + words was redundant slop).
 *
 * Route state lives in a single $route atom — no react-router. The Private AI
 * screens sit between welcome and progress; declining them routes straight to
 * the existing base install, which is unchanged.
 */
export default function App() {
  const route = useStore($route)
  const bootstrap = useStore($bootstrap)

  useEffect(() => {
    void initialize()
  }, [])

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background text-foreground">
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {route === 'welcome' && <Welcome />}
        {route === 'privacy' && <Privacy />}
        {route === 'analysis' && <Analysis />}
        {route === 'progress' && <Progress bootstrap={bootstrap} />}
        {route === 'success' && <Success />}
        {route === 'failure' && <Failure bootstrap={bootstrap} />}
      </main>
    </div>
  )
}
