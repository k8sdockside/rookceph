// One card per CephCluster: what it is, how it is, and what it is made of.
//
// A cluster is either converged -- Rook runs the mons and OSDs on these
// machines -- or external, which is Ceph elsewhere that Rook only talks to.
// The two need different pages, and the difference is drawn rather than
// explained: an external cluster has no daemon counts, because there are no
// daemons here, and saying "0 OSDs" about one would be a lie.

import { groups, ofCluster, osdSpread, type DaemonGroup } from '../model/daemons.js';
import { capacityOf, clusterView, fullnessTone, healthSentence, mixedVersions, type ClusterView } from '../model/health.js';
import { CLUSTERS, PODS, type CephCluster, type Pod } from '../model/rook.js';
import { count, percent, type Tone } from '../model/units.js';
import { byId, button, el, replace } from '../ui/dom.js';
import { every, focused, maybeList, start } from '../ui/page.js';
import { block, clickable, facts, heading, nothing, openName, pill, stack, stackLegend } from '../ui/parts.js';

const REFRESH = 10_000;

start('page', async (ctx) => {
    replace(byId('head'), heading('Ceph clusters', `The CephClusters Rook manages from ${ctx.contextName}.`));

    // The view may have been opened *on* one cluster, from a table row or
    // from the dashboard. Then only that one is drawn.
    const only = focused().name;
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const [clusters, pods] = await Promise.all([maybeList<CephCluster>({ kind: CLUSTERS }), maybeList<Pod>({ kind: PODS })]);
            failure.textContent = '';
            document.getElementById('first')?.remove();

            const views = clusters.map(clusterView).filter((view) => !only || view.name === only);
            if (views.length === 0) {
                replace(
                    body,
                    failure,
                    block(
                        only ? `No CephCluster named ${only}` : 'No CephCluster here',
                        only
                            ? 'It may have been deleted since this view was opened.'
                            : 'Rook keeps one CephCluster per namespace. Without one, Ceph is not managed from this Kubernetes cluster — though storage classes here may still provision from a Ceph elsewhere.',
                        el('p', { class: 'links' }, button('Open the storage class map', () => void k8sdockside.openView('classes'))),
                    ),
                );
                return;
            }
            replace(body, failure, ...views.map((view) => card(view, pods)));
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function card(view: ClusterView, pods: Pod[]): HTMLElement {
    const daemonGroups = view.external ? [] : groups(ofCluster(pods, view.namespace));
    const osds = daemonGroups.find((group) => group.type === 'osd')?.daemons ?? [];
    const spread = osdSpread(osds);

    return el(
        'section',
        { class: `block tone-edge-${view.tone || 'none'}`, style: 'border-left-width:3px' },
        el(
            'div',
            { class: 'card-head' },
            openName(view.name, { kind: CLUSTERS, namespace: view.namespace, name: view.name }, 'card-name'),
            el('span', { class: 'faint' }, view.namespace),
            el('span', { class: 'spacer' }),
            pill(view.health || 'not reported', view.tone),
            view.phase ? pill(view.phase, view.phase === 'Ready' || view.phase === 'Connected' ? 'ok' : 'warn') : null,
            pill(view.external ? 'external' : 'converged', view.external ? 'info' : '', view.external ? 'Ceph runs outside this Kubernetes cluster' : 'Rook runs the Ceph daemons on these machines'),
        ),
        el('p', { class: 'note' }, healthSentence(view) + (view.message ? ` ${view.message}` : '')),
        capacityBlock(view),
        el('div', { class: 'grid' }, identity(view), makeup(view, daemonGroups, spread)),
        view.checks.length > 0 ? checksBlock(view) : null,
        view.daemonVersions.length > 0 ? versionsBlock(view) : null,
        view.external ? externalNote() : null,
    );
}

function capacityBlock(view: ClusterView): HTMLElement {
    const capacity = capacityOf(view.cluster);
    if (!capacity.known) {
        return el('p', { class: 'faint' }, 'Ceph has not reported any capacity yet. Rook fills this in the first time it can read `ceph df` from the mons.');
    }
    const tone = fullnessTone(capacity);
    const segments = [
        { label: 'Used', bytes: capacity.used, tone },
        { label: 'Free', bytes: Math.max(0, capacity.total - capacity.used), tone: '' as Tone },
    ];
    return el(
        'div',
        { style: 'margin-bottom:10px' },
        stack(segments, capacity.total),
        stackLegend(segments),
        el(
            'p',
            { class: 'numbers' },
            el('span', {}, el('strong', {}, `${percent(capacity.used, capacity.total).toFixed(1)}%`), ' of raw capacity used'),
            capacity.lastUpdated ? el('span', {}, 'read ', el('strong', {}, capacity.lastUpdated)) : null,
        ),
        el(
            'p',
            { class: 'note', style: 'margin-top:4px' },
            'This is raw capacity: what the OSDs hold before replication is divided out. A pool with three copies stores a third of it. Ceph stops accepting writes at its full ratio, 95% by default.',
        ),
    );
}

/** Who this cluster is: its fsid, its version, and what Rook was told to run. */
function identity(view: ClusterView): HTMLElement {
    const pairs: [string, Node | string][] = [
        ['Ceph version', view.version || '—'],
        ['Image', el('span', { class: 'mono' }, view.image || '—')],
        ['fsid', el('span', { class: 'mono' }, view.fsid || '—')],
        ['Mode', view.external ? 'external — Ceph runs elsewhere' : 'converged — Rook runs Ceph here'],
        ['Ceph dashboard', view.dashboard ? 'on' : 'off'],
    ];
    if (!view.external) {
        const storage = view.cluster.spec?.storage;
        pairs.push(['Mons wanted', view.monsWanted ? String(view.monsWanted) : '—']);
        pairs.push([
            'Disks',
            storage?.useAllDevices
                ? 'every device Rook finds'
                : storage?.deviceFilter
                  ? `devices matching ${storage.deviceFilter}`
                  : (storage?.storageClassDeviceSets?.length ?? 0) > 0
                    ? `${count(storage?.storageClassDeviceSets?.length ?? 0, 'device set')} on PVCs`
                    : 'named per node',
        ]);
        if (view.cluster.spec?.dataDirHostPath) pairs.push(['Host path', el('span', { class: 'mono' }, view.cluster.spec.dataDirHostPath)]);
    }
    return el('div', { class: 'card' }, el('h2', {}, 'What it is'), facts(pairs));
}

/** What it is made of: device classes, OSD stores, and the daemons running. */
function makeup(view: ClusterView, daemonGroups: DaemonGroup[], spread: { nodes: number; most: number }): HTMLElement {
    const pairs: [string, Node | string][] = [];

    if (view.deviceClasses.length > 0) {
        pairs.push(['Device classes', el('span', {}, ...view.deviceClasses.map((name) => pill(name, 'info')))]);
    }
    const stores = Object.entries(view.stores);
    if (stores.length > 0) {
        pairs.push(['OSD store', stores.map(([name, n]) => `${n} × ${name}`).join(', ')]);
    }
    if (view.external) {
        pairs.push(['Daemons', 'on the external cluster — none of them run here']);
    } else {
        for (const group of daemonGroups) {
            if (group.type === 'operator' || group.type === 'crash' || group.type === 'exporter') continue;
            pairs.push([
                group.label,
                el(
                    'span',
                    {},
                    `${group.running} of ${group.total} running`,
                    group.tone !== 'ok' ? el('span', { class: `tone-${group.tone || 'none'}` }, ' — something is not') : null,
                ),
            ]);
        }
        if (spread.nodes > 0) {
            pairs.push([
                'OSD spread',
                `${count(spread.nodes, 'machine')}, at most ${count(spread.most, 'OSD')} on one` +
                    (spread.nodes < 3 ? ' — fewer than three machines cannot survive a host failure with the default CRUSH rule' : ''),
            ]);
        }
    }
    if (pairs.length === 0) return el('div', { class: 'card' }, el('h2', {}, 'What it is made of'), nothing('Nothing reported yet.'));

    const node = el('div', { class: 'card' }, el('h2', {}, 'What it is made of'), facts(pairs));
    if (!view.external && daemonGroups.length > 0) {
        const open = el('p', { class: 'links' }, button('Open the daemon map', () => void k8sdockside.openView('daemons')));
        node.append(open);
    }
    return node;
}

function checksBlock(view: ClusterView): HTMLElement {
    const list = el('ul', { class: 'checks' });
    for (const check of view.checks) {
        const row = el(
            'li',
            { class: 'check' },
            el('span', { class: `dot dot-${check.tone || 'none'}` }),
            el('span', { class: 'check-id' }, check.id),
            el('span', { class: 'check-message' }, check.message),
        );
        clickable(row, () => void k8sdockside.openUrl(`https://docs.ceph.com/en/latest/rados/operations/health-checks/#${check.id.toLowerCase()}`));
        list.append(row);
    }
    return block('Health checks', 'What `ceph status` would print. Each row opens what the check means.', list);
}

function versionsBlock(view: ClusterView): HTMLElement {
    const table = el('table');
    table.append(el('thead', {}, el('tr', {}, el('th', {}, 'Daemon'), el('th', {}, 'Ceph version'), el('th', {}, 'How many'))));
    const rows = el('tbody');
    for (const daemon of view.daemonVersions) {
        for (const version of daemon.versions) {
            rows.append(el('tr', {}, el('td', {}, daemon.type), el('td', { class: 'mono' }, version.version), el('td', {}, String(version.count))));
        }
    }
    table.append(rows);
    return block(
        'Versions the mons report',
        mixedVersions(view)
            ? 'More than one Ceph version is running. During an upgrade that is expected; left this way it is the thing that bites.'
            : 'Every daemon is on the same Ceph version.',
        table,
    );
}

function externalNote(): HTMLElement {
    return block(
        'This is an external cluster',
        'Rook holds the connection details and runs the CSI drivers; the mons, OSDs and managers are on machines this app cannot see. Health and capacity are whatever the external cluster reports, and nothing here can change it.',
        el('p', { class: 'links' }, button('How external clusters work', () => void k8sdockside.openUrl('https://rook.io/docs/rook/latest/CRDs/Cluster/external-cluster/external-cluster/'))),
    );
}
