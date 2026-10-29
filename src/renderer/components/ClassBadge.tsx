import type { MoveClass } from '../analysis/classify'
import { CLASS_INFO } from '../i18n/ru'

export function ClassIcon({ moveClass, size = 18 }: { moveClass: MoveClass; size?: number }): React.JSX.Element {
  const info = CLASS_INFO[moveClass]
  return (
    <span className="class-icon" style={{ background: info.color, width: size, height: size, fontSize: size * 0.55 }} title={info.name}>
      {moveClass === 'book' ? <BookGlyph /> : info.symbol}
    </span>
  )
}

function BookGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="70%" height="70%" aria-hidden="true">
      <path fill="currentColor" d="M2 3.2C2 2.5 2.6 2 3.3 2H7c.6 0 1 .3 1 .8V14c0-.5-.5-.9-1-.9H3.3c-.7 0-1.3-.5-1.3-1.2V3.2zm12 0c0-.7-.6-1.2-1.3-1.2H9c-.6 0-1 .3-1 .8V14c0-.5.5-.9 1-.9h3.7c.7 0 1.3-.5 1.3-1.2V3.2z" />
    </svg>
  )
}

export function ClassBadge({ moveClass }: { moveClass: MoveClass }): React.JSX.Element {
  const info = CLASS_INFO[moveClass]
  return (
    <span className="class-badge" style={{ background: info.color }}>
      <ClassIcon moveClass={moveClass} size={16} />
      {info.name}
    </span>
  )
}
