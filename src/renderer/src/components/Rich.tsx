import { Fragment } from 'react'

function inline(text: string) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Tiny markdown subset: fenced code, inline code, bold, bullet lines. */
export function Rich({ text }: { text: string }) {
  const blocks = text.split(/```[^\n]*\n?/)
  return (
    <div className="rich">
      {blocks.map((b, i) =>
        i % 2 === 1 ? (
          <pre key={i}>{b.replace(/\n$/, '')}</pre>
        ) : (
          b.split('\n').map((line, j) =>
            /^\s*[-*] /.test(line) ? (
              <div className="li" key={`${i}-${j}`}>
                {inline(line.replace(/^\s*[-*] /, ''))}
              </div>
            ) : line.trim() === '' ? (
              <div className="gap" key={`${i}-${j}`} />
            ) : (
              <p key={`${i}-${j}`}>{inline(line)}</p>
            )
          )
        )
      )}
    </div>
  )
}
