/**
 * Caps on what a run stores per subtask (2026-10-04). silent.db had grown to 56 MB in four days: 17 MB of terminal
 * lines longer than 2000 chars (whole file bodies echoed by the CLI) and 11 MB of `commands` holding Write payloads.
 * Nothing reads those back in full — the terminal shows the tail, the handover brief lists the last 5 commands.
 */
export const COMMAND_TEXT_MAX = 600
export const COMMANDS_PER_SUBTASK = 400
export const TERMINAL_LINE_MAX = 4000

export function clipText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [+${text.length - max} chars]`
}

/** Append one command to a subtask's history: clipped, newest `COMMANDS_PER_SUBTASK` kept. */
export function recordCommand(list: string[], command: string): string[] {
  const next = [...list, clipText(command, COMMAND_TEXT_MAX)]
  return next.length > COMMANDS_PER_SUBTASK ? next.slice(next.length - COMMANDS_PER_SUBTASK) : next
}
