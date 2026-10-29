import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import 'chessground/assets/chessground.base.css'
import './styles.css'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(<App />)
