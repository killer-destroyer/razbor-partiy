import type { Paragraph, Span } from '../analysis/commentary'
import { displaySan, formatLine, formatScore } from '../analysis/notation'
import { useSettings } from '../store/settings'

export function SpanView({ span }: { span: Span }): React.JSX.Element {
  const notation = useSettings((state) => state.settings.notation)
  switch (span.kind) {
    case 'text':
      return <>{span.text}</>
    case 'move':
      return <b className="mono">{displaySan(span.san, notation)}</b>
    case 'score':
      return <span className="mono score">{formatScore(span.score)}</span>
    case 'line':
      return <span className="pv-line mono">{formatLine(span.fen, span.sans, notation, 10)}</span>
  }
}

export function ParagraphView({ paragraph, className }: { paragraph: Paragraph; className?: string }): React.JSX.Element | null {
  if (!paragraph.length) return null
  const isLine = paragraph.length === 1 && paragraph[0].kind === 'line'
  return (
    <p className={`${isLine ? 'pv-paragraph' : ''} ${className ?? ''}`}>
      {paragraph.map((span, index) => (
        <SpanView key={index} span={span} />
      ))}
    </p>
  )
}

export function InlineParagraph({ paragraph }: { paragraph: Paragraph }): React.JSX.Element {
  return (
    <>
      {paragraph.map((span, index) => (
        <SpanView key={index} span={span} />
      ))}
    </>
  )
}
