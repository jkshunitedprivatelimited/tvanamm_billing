export const PAPER_KEY = 'jksh_terminal_paper_mm';

/** The paper width chosen when this device was registered
 *  (`receipt-printing.md` "Each registered terminal stores its configured
 *  paper width"). Read from localStorage, not the server, since it never
 *  changes without re-registering the terminal. */
export function terminalPaperWidthMm(): 58 | 80 {
  try {
    return localStorage.getItem(PAPER_KEY) === '58' ? 58 : 80;
  } catch {
    return 80;
  }
}
