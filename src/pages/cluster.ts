// The panel on a CephCluster: health, capacity, and Ceph's own complaints.
//
// The object view shows a status block with a `ceph.details` map in it, which
// is the most important thing Rook records and the least readable way it
// could be written. This is that map, as a list, worst first.

import { capacityOf, clusterView, fullnessTone, healthSentence } from '../model/health.js';
import type { CephCluster } from '../model/rook.js';
import { percent, size, type Tone } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { start } from '../ui/page.js';
import { clickable, facts, nothing, pill, stack } from '../ui/parts.js';

start('panel', async () => {
    const host = byId('panel');
    const view = clusterView(await k8sdockside.object<CephCluster>());
    const capacity = capacityOf(view.cluster);

    const head = el(
        'div',
        { class: 'panel-head' },
        pill(view.health || 'not reported', view.tone),
        view.phase ? pill(view.phase, view.phase === 'Ready' || view.phase === 'Connected' ? 'ok' : 'warn') : null,
        pill(view.external ? 'external Ceph' : 'converged', view.external ? 'info' : ''),
        view.version ? pill(`Ceph ${view.version}`, '') : null,
        view.dashboard ? pill('dashboard on', '') : null,
    );

    const pairs: [string, Node | string][] = [['Status', healthSentence(view)]];
    if (view.fsid) pairs.push(['fsid', el('span', { class: 'mono' }, view.fsid)]);
    if (view.deviceClasses.length > 0) pairs.push(['Device classes', view.deviceClasses.join(', ')]);
    const stores = Object.entries(view.stores);
    if (stores.length > 0) pairs.push(['OSD store', stores.map(([name, n]) => `${n} × ${name}`).join(', ')]);
    if (view.message) pairs.push(['Rook says', view.message]);

    replace(host, head, capacityPiece(capacity), facts(pairs), checks(view.checks));
});

function capacityPiece(capacity: ReturnType<typeof capacityOf>): HTMLElement {
    if (!capacity.known) return el('p', { class: 'faint' }, 'Ceph has not reported any capacity yet.');
    const tone = fullnessTone(capacity);
    const segments = [
        { label: 'Used', bytes: capacity.used, tone },
        { label: 'Free', bytes: Math.max(0, capacity.total - capacity.used), tone: '' as Tone },
    ];
    return el(
        'div',
        { style: 'margin-bottom:8px' },
        stack(segments, capacity.total),
        el(
            'p',
            { class: 'numbers', style: 'margin-top:4px' },
            el('span', {}, el('strong', {}, size(capacity.used)), ' used'),
            el('span', {}, el('strong', {}, size(capacity.total)), ' raw'),
            el('span', {}, el('strong', {}, `${percent(capacity.used, capacity.total).toFixed(0)}%`), ' full'),
        ),
    );
}

function checks(list: ReturnType<typeof clusterView>['checks']): HTMLElement {
    if (list.length === 0) return nothing('Ceph is not complaining about anything.');
    const node = el('ul', { class: 'checks' });
    for (const check of list) {
        const row = el(
            'li',
            { class: 'check' },
            el('span', { class: `dot dot-${check.tone || 'none'}` }),
            el('span', { class: 'check-id' }, check.id),
            el('span', { class: 'check-message' }, check.message),
        );
        clickable(row, () => void k8sdockside.openUrl(`https://docs.ceph.com/en/latest/rados/operations/health-checks/#${check.id.toLowerCase()}`));
        node.append(row);
    }
    return node;
}
