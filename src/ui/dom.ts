// Small DOM helpers.
//
// The rule these exist to enforce: cluster data goes on the page as text,
// never as HTML. el(), button(), replace(), byId() and svg() come from the
// SDK, where every plugin shares one copy; svg() is the only one that takes
// markup, and it is only ever handed the icon constants in icons.ts. A page
// that builds its rows with `el` cannot have an injection bug through an
// object's name or an operator's error message, which is the one place
// cluster data is genuinely hostile.

import { el } from '@k8sdockside/plugin-sdk/dom';

export { el, button, replace, byId, svg } from '@k8sdockside/plugin-sdk/dom';

/** A coloured dot for a tone. */
export function dot(tone: string): HTMLElement {
    return el('span', { class: `dot dot-${tone || 'none'}`, 'aria-hidden': 'true' });
}
