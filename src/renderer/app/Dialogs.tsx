import { useEffect, useState } from 'react'
import { ru } from '../i18n/ru'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="toast-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function AboutContent(): React.JSX.Element {
  const [versions, setVersions] = useState<{ app: string; electron: string; chrome: string; node: string } | null>(null)
  useEffect(() => {
    void window.api.app.version().then(setVersions)
  }, [])
  return (
    <div className="about">
      <div className="about-head">
        <span className="brand-icon large">♞</span>
        <div>
          <h3>{ru.appTitle}</h3>
          <p className="muted small">
            Версия {versions?.app ?? '…'} · Electron {versions?.electron ?? '…'}
          </p>
        </div>
      </div>
      <p>{ru.about.description}</p>
      <h4>{ru.about.licenses}</h4>
      <ul className="license-list">
        {ru.about.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="muted small">
        Программа распространяется под GPL-3.0 (из-за chessground и Stockfish). Только для личного использования; не связана с chess.com.
      </p>
    </div>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title={ru.about.title} onClose={onClose}>
      <AboutContent />
    </Modal>
  )
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title={ru.about.shortcuts} onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {ru.about.shortcutList.map(([keys, description]) => (
            <tr key={keys}>
              <td>
                <kbd>{keys}</kbd>
              </td>
              <td>{description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
