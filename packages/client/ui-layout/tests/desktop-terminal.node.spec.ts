// @vitest-environment node
import { expect, it } from 'vitest'
import { createDesktopTerminalWorkspace } from '@deepseek-ai/dsh-client-ui-layout/src/client/desktop-terminal.ts'

it('does not expose the native desktop terminal workspace outside a browser realm', () => {
  expect(createDesktopTerminalWorkspace()).toBeUndefined()
})
