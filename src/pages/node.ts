// The panel on a Node: which Ceph daemons are on this machine.
//
// The question it answers is the one asked before every reboot: what does
// draining this node cost. A monitor is the expensive one -- a quorum is more
// than half, so losing one of three is the whole margin -- and the OSDs are
// the slow one, because whatever they hold has to be rebuilt elsewhere.

import { onNode, type DaemonView } from '../model/daemons.js';
import { PODS, type Pod } from '../model/rook.js';
import { count } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { maybeList, start } from '../ui/page.js';
import { clickable, nothing, pill } from '../ui/parts.js';

start('panel', async () => {
    const host = byId('panel');
    const node = await k8sdockside.object();
    const pods = await maybeList<Pod>({ kind: PODS });
    const daemons = onNode(pods, node.metadata.name);

    if (daemons.length === 0) {
        replace(host, nothing('No Ceph daemon runs on this machine. Rook schedules mons and OSDs onto the nodes it was given disks on; everything else follows its own placement rules.'));
        return;
    }

    const mons = daemons.filter((daemon) => daemon.type === 'mon').length;
    const osds = daemons.filter((daemon) => daemon.type === 'osd').length;
    const broken = daemons.filter((daemon) => daemon.tone === 'error' || daemon.tone === 'warn');

    replace(
        host,
        el(
            'div',
            { class: 'panel-head' },
            pill(`${daemons.length - broken.length} of ${daemons.length} running`, broken.length === 0 ? 'ok' : 'warn'),
            mons > 0 ? pill(count(mons, 'monitor'), 'info') : null,
            osds > 0 ? pill(count(osds, 'OSD'), 'info') : null,
        ),
        el('div', { class: 'daemons' }, ...daemons.map(tile)),
        cost(mons, osds),
    );
});

function tile(daemon: DaemonView): HTMLElement {
    const label = daemon.id ? `${daemon.type}.${daemon.id}` : daemon.name.replace(/^rook-ceph-/, '');
    const node = el(
        'span',
        { class: `daemon tone-edge-${daemon.tone || 'none'}`, title: daemon.problem || `${daemon.name} — ${daemon.phase}` },
        el('span', { class: `dot dot-${daemon.tone || 'none'}` }),
        el('span', { class: 'daemon-id' }, label),
        daemon.deviceClass ? pill(daemon.deviceClass, '', 'The device class Ceph put this disk in') : null,
        daemon.role ? pill(daemon.role, daemon.role === 'active' ? 'ok' : '') : null,
        daemon.restarts > 0 ? pill(`${daemon.restarts}×`, daemon.restarts > 3 ? 'warn' : '') : null,
    );
    clickable(node, () => void k8sdockside.open({ kind: PODS, namespace: daemon.namespace, name: daemon.name }));
    return node;
}

/** What taking this machine out actually costs, in one sentence. */
function cost(mons: number, osds: number): HTMLElement | null {
    const parts: string[] = [];
    if (mons > 0) parts.push(`${count(mons, 'monitor')} — a quorum is more than half of them, so check how many are left before you drain this node`);
    if (osds > 0) parts.push(`${count(osds, 'OSD')} — Ceph rebuilds what they held onto the remaining disks, which copies data across the network`);
    if (parts.length === 0) return null;
    return el('p', { class: 'note', style: 'margin:8px 0 0' }, `Draining this machine takes down ${parts.join('; and ')}.`);
}
