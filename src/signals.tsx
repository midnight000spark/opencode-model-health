// Why `.tsx`: OpenCode's host Bun plugin rewrites `solid-js` to its shared
// runtime instance only for `.tsx`/`.jsx` modules. Signals created from a
// plain `.ts` module would bind to a second `solid-js` copy, so updates would
// never reach the dialog renderer. Re-exporting through this `.tsx` module
// keeps every consumer on the host's single reactive instance.
export { createSignal } from "solid-js"
export type { Accessor } from "solid-js"
