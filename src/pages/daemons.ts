// Every Ceph daemon, by what it is and where it runs.
//
// Two ways of looking at the same pods, because the two questions are
// different. "Is anything down" is answered by type: mons together, OSDs
// together. "Can I take this machine out" is answered by node: every daemon
// on it at once, which is the view that tells you whether rebooting the box
// costs you a mon quorum.
//
// All of it comes from pod labels Rook stamps on: `app` says which daemon,
// `ceph-osd-id`, `device-class` and `failure-domain` say which disk an OSD
// is. Nothing here asks Ceph anything.

import { DAEMONS, groups, type DaemonGroup, type DaemonView } from '../model/daemons.js';
import { CLUSTERS, PODS, type CephCluster, type Pod } from '../model/rook.js';
import { count } from '../model/units.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, maybeList, since, start } from '../ui/page.js';
import { block, clickable, heading, nothing, pill } from '../ui/parts.js';

const REFRESH = 10_000;

type Layout = 'type' | 'node';
let layout: Layout = 'type';

start('page', async (ctx) => {
    replace(byId('head'), heading('Daemons & OSDs', `Every Ceph daemon Rook runs in ${ctx.contextName}, and the machine it runs on.`));

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    let pods: Pod[] = [];
    let clusters: CephCluster[] = [];

    const byType = button('By daemon', () => pick('type'));
    const byNode = button('By machine', () => pick('node'));
    const pick = (next: Layout) => {
        layout = next;
        byType.classList.toggle('primary', layout === 'type');
        byNode.classList.toggle('primary', layout === 'node');
        void k8sdockside.storage?.set('daemon-layout', layout);
        render(body, failure, pods, clusters);
    };

    // The choice is remembered per cluster, so a page anyone keeps open on a
    // second monitor comes back the way they left it.
    const remembered = await k8sdockside.storage?.get<Layout>('daemon-layout');
    layout = remembered === 'node' ? 'node' : 'type';
    byType.classList.toggle('primary', layout === 'type');
    byNode.classList.toggle('primary', layout === 'node');
    replace(byId('bar'), byType, byNode);

    const stop = every(
        REFRESH,
        async () => {
            [pods, clusters] = await Promise.all([maybeList<Pod>({ kind: PODS }), maybeList<CephCluster>({ kind: CLUSTERS })]);
            failure.textContent = '';
            document.getElementById('first')?.remove();
            render(body, failure, pods, clusters);
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function render(host: HTMLElement, failure: HTMLElement, pods: Pod[], clusters: CephCluster[]): void {
    const all = groups(pods);
    if (all.length === 0) {
        const external = clusters.filter((cluster) => cluster.spec?.external?.enable === true);
        replace(
            host,
            failure,
            block(
                'No Ceph daemons run here',
                external.length > 0
                    ? `${external.map((c) => c.metadata.name).join(', ')} ${external.length === 1 ? 'is an external cluster' : 'are external clusters'}: the mons, managers and OSDs are on machines outside this Kubernetes cluster, and nothing about them can be read from here.`
                    : 'No pod in this cluster carries a rook-ceph app label. Either Rook is not installed, or its operator has not made anything yet.',
                nothing('The storage classes and the pools they point at are still worth a look.'),
            ),
        );
        return;
    }
    replace(host, failure, ...(layout === 'type' ? byDaemonType(all) : byMachine(all)));
}

/** Mons together, OSDs together: "is anything down". */
function byDaemonType(all: DaemonGroup[]): Node[] {
    return all.map((group) =>
        block(
            '',
            '',
            el(
                'div',
                { class: 'group-head' },
                el('h2', { style: 'margin:0' }, group.label),
                el('span', { class: `group-count tone-${group.tone || 'none'}` }, `${group.running} of ${group.total} running`),
                el('span', { class: 'kind-gives' }, group.note),
            ),
            el('div', { class: 'daemons' }, ...group.daemons.map((daemon) => tile(daemon))),
            quorumNote(group),
        ),
    );
}

/** Everything on one machine: "can I take this node out". */
function byMachine(all: DaemonGroup[]): Node[] {
    const daemons = all.flatMap((group) => group.daemons);
    const nodes = new Map<string, DaemonView[]>();
    for (const daemon of daemons) {
        const node = daemon.node || 'not scheduled';
        nodes.set(node, [...(nodes.get(node) ?? []), daemon]);
    }

    return [...nodes.entries()]
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([node, here]) => {
            const mons = here.filter((daemon) => daemon.type === 'mon').length;
            const osds = here.filter((daemon) => daemon.type === 'osd').length;
            const broken = here.filter((daemon) => daemon.tone === 'error' || daemon.tone === 'warn').length;
            return block(
                '',
                '',
                el(
                    'div',
                    { class: 'group-head' },
                    el('h2', { style: 'margin:0' }, node),
                    el('span', { class: `group-count tone-${broken ? 'warn' : 'ok'}` }, `${here.length - broken} of ${here.length} running`),
                    mons > 0 ? pill(count(mons, 'mon'), 'info', 'Taking this machine out costs a monitor') : null,
                    osds > 0 ? pill(count(osds, 'OSD'), 'info', 'Taking this machine out takes these OSDs down with it') : null,
                ),
                el('div', { class: 'daemons' }, ...here.map((daemon) => tile(daemon, true))),
            );
        });
}

/** One daemon, as a tile that opens the pod. */
function tile(daemon: DaemonView, withType = false): HTMLElement {
    const label = daemon.id ? `${daemonWord(daemon)}.${daemon.id}` : daemon.name.replace(/^rook-ceph-/, '');
    const node = el(
        'span',
        { class: `daemon tone-edge-${daemon.tone || 'none'}`, title: daemon.problem || `${daemon.name} — ${daemon.phase}` },
        el('span', { class: `dot dot-${daemon.tone || 'none'}` }),
        el('span', { class: 'daemon-id' }, withType || !daemon.id ? label : `${daemonWord(daemon)}.${daemon.id}`),
        daemon.deviceClass ? pill(daemon.deviceClass, '', 'The device class Ceph put this disk in') : null,
        daemon.role ? pill(daemon.role, daemon.role === 'active' ? 'ok' : '', 'Which manager is serving the dashboard and the metrics') : null,
        el('span', { class: 'daemon-where' }, withType ? since(daemon.startedAt) : daemon.node || 'not scheduled'),
        daemon.restarts > 0 ? pill(`${daemon.restarts}×`, daemon.restarts > 3 ? 'warn' : '', `Restarted ${daemon.restarts} times`) : null,
    );
    clickable(node, () => void k8sdockside.open({ kind: PODS, namespace: daemon.namespace, name: daemon.name }));
    return node;
}

/** `osd`, `mon`, `mds` — the word Ceph itself uses for the daemon. */
function daemonWord(daemon: DaemonView): string {
    return DAEMONS.find((entry) => entry.type === daemon.type)?.type ?? daemon.type;
}

/**
 * The one thing about mons that is worth saying and is not in any status
 * field: a quorum is more than half of them, so an even number buys nothing
 * and two of anything cannot lose one.
 */
function quorumNote(group: DaemonGroup): HTMLElement | null {
    if (group.type !== 'mon') return null;
    const need = Math.floor(group.total / 2) + 1;
    if (group.total === 0) return null;
    const short = group.running < need;
    const even = group.total % 2 === 0;
    if (!short && !even) return null;
    return el(
        'p',
        { class: short ? 'card-problem' : 'note', style: 'margin-top:8px' },
        short
            ? `Only ${group.running} of ${group.total} monitors are running, and a quorum needs ${need}. Ceph stops serving reads and writes without one.`
            : `${group.total} monitors is an even number: a quorum still needs ${need}, so the extra one buys no more tolerance than ${group.total - 1} would.`,
    );
}
