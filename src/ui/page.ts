// The things every page in this plugin does the same way.
//
//  1. `start` wraps the page in one try/catch. Every bridge call rejects with
//     an Error carrying a sentence written for a person, so the honest thing
//     to do with a failure is show that sentence -- not a blank page and a
//     console nobody can open, because the page is in a sandboxed frame.
//  2. `fail` puts it where the user is looking.
//  3. Nothing subscribes to the theme: the SDK writes the app's tokens onto
//     :root before `ready()` resolves and rewrites them when the user
//     switches, so a stylesheet in var(--text) follows along on its own. The
//     rings and bars are SVG with `fill="currentColor"` or a class, for the
//     same reason.

import { el, replace } from './dom.js';

/** Shows a failure where the user is looking, as a sentence. */
export function fail(host: HTMLElement, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    replace(
        host,
        el('div', { class: 'failure' }, el('strong', {}, 'That did not work. '), el('span', {}, message)),
    );
}

/**
 * Runs a page's body once the bridge is ready, and shows anything that goes
 * wrong instead of dying silently.
 */
export function start(hostId: string, body: (ctx: K8sDockside.Context) => Promise<void>): void {
    const run = async () => {
        const host = document.getElementById(hostId);
        try {
            const ctx = await k8sdockside.ready();
            await body(ctx);
        } catch (err) {
            if (host) fail(host, err);
        }
    };
    void run();
}

/**
 * How long ago a timestamp was, in the app's shorthand. Kubernetes writes
 * RFC 3339; an absent or unparseable one reads as an em dash rather than
 * "NaN", which is the kind of thing users report as a bug.
 */
export function since(timestamp: string | undefined, now = Date.now()): string {
    if (!timestamp) return '—';
    const then = Date.parse(timestamp);
    if (Number.isNaN(then)) return '—';
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

/** Milliseconds since a timestamp, or Infinity when there is none. */
export function age(timestamp: string | undefined, now = Date.now()): number {
    if (!timestamp) return Infinity;
    const then = Date.parse(timestamp);
    return Number.isNaN(then) ? Infinity : Math.max(0, now - then);
}

/** `namespace/name`, or just the name when there is no namespace. */
export function where(namespace: string, name: string): string {
    return namespace ? `${namespace}/${name}` : name;
}

/** What follows the # in a focused page's address, as the app writes it. */
export function focused(): { namespace: string; name: string } {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { namespace: params.get('namespace') ?? '', name: params.get('name') ?? '' };
}

/**
 * Runs `body` now and every `ms` milliseconds after it, and hands anything it
 * throws to `onError`. The page has no network of its own, so this is how a
 * view stays live: the bridge's `watch` polls one list, and this polls the
 * handful of lists a page needs together.
 */
export function every(ms: number, body: () => Promise<void>, onError: (err: unknown) => void): () => void {
    let stopped = false;
    const tick = async () => {
        if (stopped) return;
        try {
            await body();
        } catch (err) {
            onError(err);
        }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

/**
 * A list of a kind the cluster may not serve: empty rather than a failure.
 *
 * Almost everything Rook defines is optional in the manifest -- a cluster
 * that consumes Ceph over CSI and runs no operator has none of the CRDs, and
 * one that runs Ceph but serves no objects has no CephObjectStore kind at
 * all. A page that asks for one should draw the rest of itself rather than
 * die with "the cluster does not serve crd:cephobjectstores.ceph.rook.io".
 */
export async function maybeList<T extends K8sDockside.KubeObject = K8sDockside.KubeObject>(
    query: K8sDockside.ListQuery,
): Promise<T[]> {
    try {
        return await k8sdockside.list<T>(query);
    } catch {
        return [];
    }
}
