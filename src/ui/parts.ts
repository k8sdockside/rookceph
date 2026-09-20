// The pieces the Rook Ceph pages are drawn from: rings, bars, pills, cards.
//
// They are built as SVG and CSS classes rather than with colour values, so
// the app's theme tokens colour them and a switch from light to dark needs no
// JavaScript at all.

import { el, replace, svg } from './dom.js';
import { percent, size, type Tone } from '../model/units.js';

/** An SVG element, with attributes. SVG needs its own namespace. */
export function svgEl(tag: string, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElement {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    for (const child of children) node.append(child);
    return node;
}

export interface Slice {
    label: string;
    count: number;
    tone: Tone;
}

/**
 * A donut: one arc per slice, the total in the middle, a legend beside it.
 * The whole legend row is a button when `onPick` is given, so "three OSDs are
 * down" is also the way to find out which three.
 */
export function ring(title: string, slices: Slice[], options: { onPick?: (label: string) => void; unit?: string } = {}): HTMLElement {
    const total = slices.reduce((n, s) => n + s.count, 0);
    const R = 54;
    const C = 2 * Math.PI * R;
    const drawing = svgEl('svg', { viewBox: '0 0 140 140', class: 'ring-svg', 'aria-hidden': 'true' });
    drawing.append(svgEl('circle', { cx: 70, cy: 70, r: R, class: 'ring-track', fill: 'none', 'stroke-width': 16 }));

    let offset = 0;
    for (const slice of slices) {
        if (slice.count <= 0) continue;
        const fraction = total > 0 ? slice.count / total : 0;
        drawing.append(
            svgEl('circle', {
                cx: 70,
                cy: 70,
                r: R,
                fill: 'none',
                'stroke-width': 16,
                'stroke-linecap': 'butt',
                class: `ring-arc arc-${slice.tone || 'none'}`,
                'stroke-dasharray': `${(fraction * C).toFixed(2)} ${C.toFixed(2)}`,
                'stroke-dashoffset': `${(-offset * C).toFixed(2)}`,
                transform: 'rotate(-90 70 70)',
            }),
        );
        offset += fraction;
    }

    const legend = el('ul', { class: 'legend' });
    for (const slice of slices) {
        const row = el(
            'li',
            { class: slice.count === 0 ? 'legend-row zero' : 'legend-row' },
            el('span', { class: `dot dot-${slice.tone || 'none'}` }),
            el('span', { class: 'legend-label' }, slice.label),
            el('span', { class: 'legend-count' }, String(slice.count)),
        );
        if (options.onPick && slice.count > 0) clickable(row, () => options.onPick?.(slice.label));
        legend.append(row);
    }

    return el(
        'section',
        { class: 'ring-card' },
        el('h2', {}, title),
        el(
            'div',
            { class: 'ring-body' },
            el(
                'div',
                { class: 'ring-holder' },
                drawing,
                el('div', { class: 'ring-centre' }, el('span', { class: 'ring-total' }, String(total)), el('span', { class: 'ring-unit' }, options.unit ?? '')),
            ),
            legend,
        ),
    );
}

export interface Segment {
    label: string;
    bytes: number;
    tone: Tone;
}

/** A stacked bar of bytes, with `whole` as what the segments are a part of. */
export function stack(segments: Segment[], whole: number): HTMLElement {
    const bar = el('div', { class: 'stack' });
    for (const segment of segments) {
        if (segment.bytes <= 0) continue;
        const piece = el('span', { class: `stack-part fill-${segment.tone || 'none'}`, title: `${segment.label}: ${size(segment.bytes)}` });
        piece.style.width = `${percent(segment.bytes, whole)}%`;
        bar.append(piece);
    }
    return bar;
}

/** The legend under a stacked bar: a dot, a name and a size each. */
export function stackLegend(segments: Segment[]): HTMLElement {
    const list = el('ul', { class: 'stack-legend' });
    for (const segment of segments) {
        list.append(
            el(
                'li',
                {},
                el('span', { class: `dot dot-${segment.tone || 'none'}` }),
                el('span', { class: 'stack-name' }, segment.label),
                el('span', { class: 'stack-size' }, size(segment.bytes)),
            ),
        );
    }
    return list;
}

/** A thin progress bar, 0-100. */
export function progress(value: number, tone: Tone = 'warn'): HTMLElement {
    const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(value) });
    const fill = el('span', { class: `progress-fill fill-${tone || 'none'}` });
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.append(fill);
    return bar;
}

/** A small coloured label: a health word, a phase, a device class. */
export function pill(text: string, tone: Tone = '', title = ''): HTMLElement {
    return el('span', { class: `pill pill-${tone || 'none'}`, ...(title ? { title } : {}) }, text);
}

/** A labelled number, the tile the dashboard's top row is built from. */
export function stat(label: string, value: string, note = '', tone: Tone = ''): HTMLElement {
    return el(
        'div',
        { class: 'stat' },
        el('div', { class: `stat-value tone-${tone || 'none'}` }, value),
        el('div', { class: 'stat-label' }, label),
        note ? el('div', { class: 'stat-note' }, note) : null,
    );
}

/** A section with a heading, an optional sentence, and whatever follows. */
export function block(title: string, note: string, ...children: (Node | null)[]): HTMLElement {
    return el('section', { class: 'block' }, el('h2', {}, title), note ? el('p', { class: 'note' }, note) : null, ...children.filter((c): c is Node => c !== null));
}

/** A row of facts: a term and a value each, in two columns. */
export function facts(pairs: [string, Node | string][]): HTMLElement {
    const list = el('dl', { class: 'facts' });
    for (const [term, value] of pairs) {
        list.append(el('dt', {}, term), el('dd', {}, typeof value === 'string' ? value || '—' : value));
    }
    return list;
}

/** An empty state that says what would have been here. */
export function nothing(message: string): HTMLElement {
    return el('p', { class: 'empty' }, message);
}

/** A page's own heading, with the plugin's mark beside it. */
export function heading(title: string, note: string): HTMLElement {
    return el(
        'header',
        { class: 'page-head' },
        el('img', { class: 'mark', src: 'logo.svg', alt: '', width: 26, height: 26 }),
        el('div', {}, el('h1', {}, title), note ? el('p', { class: 'note' }, note) : null),
    );
}

/** Replaces a host's contents with a single "still reading" line. */
export function loading(host: HTMLElement, message: string): void {
    replace(host, el('p', { class: 'loading' }, message));
}

/**
 * Makes a row behave like a button: clickable, focusable, and answering the
 * keys a button answers. A <div> that opens something and cannot be reached
 * with a keyboard is a page half the people cannot use.
 */
export function clickable(node: HTMLElement, onPick: () => void): HTMLElement {
    node.classList.add('pick');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('click', onPick);
    node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPick();
        }
    });
    return node;
}

/** A button that opens an object in the app, drawn as the name of the thing. */
export function openName(label: string, ref: K8sDockside.ObjectRef, className = 'card-name'): HTMLElement {
    const node = el('button', { type: 'button', class: className, title: `Open ${label}` }, label);
    node.addEventListener('click', () => void k8sdockside.open(ref));
    return node;
}

/** A key/value line for a parameter table: the name in monospace, then the value. */
export function param(name: string, value: string): HTMLElement {
    return el('li', { class: 'param' }, el('span', { class: 'param-name mono' }, name), el('span', { class: 'param-value mono' }, value));
}

export { el, replace, svg };
