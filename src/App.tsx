import { AppHeader } from './components/AppHeader'
import {
  paths,
  parseScope,
  useNavigate,
  useNavigationKey,
  useRoute,
  useScrollReset,
} from './lib/router'
import { useStore } from './state/store'
import { Coverage } from './views/Coverage'
import { CheatSheet } from './views/CheatSheet'
import { Library } from './views/Library'
import { SubtopicView, TopicView } from './views/Reference'
import { SessionView } from './views/SessionView'
import { SettingsView } from './views/SettingsView'

export default function App() {
  const route = useRoute()
  const navKey = useNavigationKey()
  const { ready, activePack, packs } = useStore()
  const navigate = useNavigate()

  useScrollReset(route)

  if (!ready) {
    return (
      <div className="app">
        <div className="shell shell-narrow view">
          <p className="t-small t-dimmer">Loading…</p>
        </div>
      </div>
    )
  }

  // Settings and the library work with no pack open; everything else needs one.
  const needsPack = route.name !== 'library' && route.name !== 'settings'

  return (
    <div className="app">
      <AppHeader route={route} />

      <main className="app-main">
        {route.name === 'library' && <Library />}
        {route.name === 'settings' && <SettingsView />}

        {needsPack && !activePack && (
          <NoPack hasPacks={packs.length > 0} onGo={() => navigate(paths.library())} />
        )}

        {needsPack && activePack && (
          <>
            {route.name === 'coverage' && <Coverage pack={activePack} />}
            {route.name === 'topic' && <TopicView pack={activePack} topicId={route.topicId} />}
            {route.name === 'subtopic' && (
              <SubtopicView pack={activePack} subtopicId={route.subtopicId} />
            )}
            {route.name === 'session' && (
              <SessionView
                // Keyed on the navigation, so asking for the same session
                // again starts a new run rather than showing the old summary.
                key={`${route.mode}:${route.scope}:${navKey}`}
                pack={activePack}
                mode={route.mode}
                scope={parseScope(route.scope)}
              />
            )}
            {route.name === 'cheatsheet' && <CheatSheet pack={activePack} />}
          </>
        )}
      </main>
    </div>
  )
}

function NoPack({ hasPacks, onGo }: { hasPacks: boolean; onGo: () => void }) {
  return (
    <div className="shell shell-narrow view">
      <div className="panel empty">
        <h1 className="t-h2">{hasPacks ? 'Choose a pack' : 'No study material loaded yet'}</h1>
        <p className="prose t-small">
          {hasPacks
            ? 'Pick which pack you want to work on.'
            : 'Overlearn works from packs generated out of your own course material. Load one to get started — it stays in this browser.'}
        </p>
        <button type="button" className="btn btn-primary btn-lg" onClick={onGo}>
          {hasPacks ? 'Choose a pack' : 'Load a pack'}
        </button>
      </div>
    </div>
  )
}
