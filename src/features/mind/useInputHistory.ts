import * as React from "react"

/** Per-key history kept across re-mounts (the dock switches between chat and terminal). */
const HISTORY = new Map<string, string[]>()
const MAX = 100

/** Shell-like ↑/↓ recall for an input: `push` after sending, `onKeyDown` wired to the field. */
export function useInputHistory(key: string, seed: string[], draft: string, setDraft: (v: string) => void) {
  const indexRef = React.useRef<number | null>(null)
  const keepRef = React.useRef("")
  const list = HISTORY.get(key) ?? (HISTORY.set(key, [...seed].slice(-MAX)), HISTORY.get(key)!)
  const push = (text: string) => {
    const l = HISTORY.get(key) ?? []
    if (l[l.length - 1] !== text) l.push(text)
    if (l.length > MAX) l.splice(0, l.length - MAX)
    HISTORY.set(key, l)
    indexRef.current = null
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    const l = HISTORY.get(key) ?? list
    if (!l.length) return false
    const el = e.currentTarget
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    const atEnd = el.selectionStart === el.value.length
    const singleLine = !el.value.includes("\n")
    if (e.key === "ArrowUp" && (indexRef.current !== null || atStart || (singleLine && !el.value))) {
      e.preventDefault()
      if (indexRef.current === null) {
        keepRef.current = draft
        indexRef.current = l.length - 1
      } else if (indexRef.current > 0) indexRef.current -= 1
      setDraft(l[indexRef.current]!)
      return true
    }
    if (e.key === "ArrowDown" && indexRef.current !== null && (atEnd || singleLine)) {
      e.preventDefault()
      if (indexRef.current < l.length - 1) {
        indexRef.current += 1
        setDraft(l[indexRef.current]!)
      } else {
        indexRef.current = null
        setDraft(keepRef.current)
      }
      return true
    }
    return false
  }
  return { push, onKeyDown }
}
