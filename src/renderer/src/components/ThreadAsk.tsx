import type { Message, Project, Thread } from '../types'
import { extractQuestion, isCurrentAsk } from '../../../shared/ask-question.ts'
import { AskCard } from './AskCard'

/** The question card inside the thread itself, built from the reply that asked it. */
export function ThreadAsk({ project, thread, message }: { project: Project; thread: Thread; message: Message }) {
  const q = extractQuestion(message.text)
  if (!q) return null
  return (
    <AskCard
      project={project}
      ask={{ threadId: thread.id, question: q.text, options: q.options, recommended: q.recommended }}
      stale={!isCurrentAsk(thread.messages, message)}
    />
  )
}
