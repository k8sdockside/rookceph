// The panel on a StorageClass: what it means, in words.
//
// The object's own view is a list of parameters. This says what they add up
// to -- what a pod gets, from which Ceph, kept how many times -- and shows
// every parameter after it, including the CSI secret references the map view
// leaves out, because on this page they are exactly what someone is looking
// for.

import { classView, KIND_WORDS, poolName } from '../model/classes.js';
import {
    BLOCK_POOLS,
    CLUSTERS,
    FILESYSTEMS,
    NFSES,
    OBJECT_STORES,
    PVCS,
    durability,
    fragile,
    type CephBlockPool,
    type CephCluster,
    type CephFilesystem,
    type CephNFS,
    type CephObjectStore,
    type PersistentVolumeClaim,
    type StorageClass,
} from '../model/rook.js';
import { size } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { maybeList, start } from '../ui/page.js';
import { facts, nothing, openName, param, pill } from '../ui/parts.js';

start('panel', async () => {
    const host = byId('panel');
    const storageClass = await k8sdockside.object<StorageClass>();

    const [clusters, pools, filesystems, objectStores, nfses, claims] = await Promise.all([
        maybeList<CephCluster>({ kind: CLUSTERS }),
        maybeList<CephBlockPool>({ kind: BLOCK_POOLS }),
        maybeList<CephFilesystem>({ kind: FILESYSTEMS }),
        maybeList<CephObjectStore>({ kind: OBJECT_STORES }),
        maybeList<CephNFS>({ kind: NFSES }),
        maybeList<PersistentVolumeClaim>({ kind: PVCS }),
    ]);

    const view = classView(storageClass, { clusters, pools, filesystems, objectStores, nfses, claims });
    if (!view) {
        replace(host, nothing(`This is not a Ceph storage class: its provisioner is ${storageClass.provisioner ?? 'not set'}.`));
        return;
    }

    const pairs: [string, Node | string][] = [
        ['A pod gets', KIND_WORDS[view.kind].gives],
        ['From', view.cluster ? openName(view.cluster.metadata.name, { kind: CLUSTERS, namespace: view.cluster.metadata.namespace ?? '', name: view.cluster.metadata.name }, 'card-name') : el('span', { class: 'faint' }, view.backing.clusterID ? `cluster id ${view.backing.clusterID}, outside this Kubernetes cluster` : 'a Ceph this plugin cannot see')],
    ];

    if (view.pool) {
        pairs.push(['Pool', openName(poolName(view.pool), { kind: BLOCK_POOLS, namespace: view.pool.metadata.namespace ?? '', name: view.pool.metadata.name }, 'card-name')]);
        pairs.push([
            'Redundancy',
            el('span', {}, durability(view.pool.spec) || '—', fragile(view.pool.spec) ? el('span', { class: 'tone-warn' }, ' — one failed OSD loses it') : null),
        ]);
    }
    if (view.filesystem) {
        pairs.push(['Filesystem', openName(view.filesystem.metadata.name, { kind: FILESYSTEMS, namespace: view.filesystem.metadata.namespace ?? '', name: view.filesystem.metadata.name }, 'card-name')]);
    }
    if (view.objectStore) {
        pairs.push(['Object store', openName(view.objectStore.metadata.name, { kind: OBJECT_STORES, namespace: view.objectStore.metadata.namespace ?? '', name: view.objectStore.metadata.name }, 'card-name')]);
    }
    if (view.nfs) {
        pairs.push(['NFS server', openName(view.nfs.metadata.name, { kind: NFSES, namespace: view.nfs.metadata.namespace ?? '', name: view.nfs.metadata.name }, 'card-name')]);
    }

    pairs.push([
        'When the claim goes',
        view.reclaim === 'Retain'
            ? 'the Ceph image or subvolume is kept — you delete it yourself'
            : view.reclaim === 'Delete'
              ? 'the Ceph image or subvolume is deleted with it'
              : view.reclaim,
    ]);
    pairs.push(['Bound', view.binding === 'WaitForFirstConsumer' ? 'when the first pod that uses it is scheduled' : 'as soon as the claim is made']);
    pairs.push(['In use', `${view.claims} claim${view.claims === 1 ? '' : 's'}, ${size(view.requested)}${view.pending ? `, ${view.pending} pending` : ''}`]);

    const parameters = Object.entries(storageClass.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b));

    replace(
        host,
        el(
            'div',
            { class: 'panel-head' },
            pill(KIND_WORDS[view.kind].label, 'info'),
            view.isDefault ? pill('default class', 'ok') : null,
            view.expansion ? pill('expandable', 'ok') : pill('fixed size', ''),
            view.backing.encrypted ? pill('encrypted', 'ok') : null,
            el('span', { class: 'spacer' }),
            el('span', { class: 'faint mono' }, view.provisioner),
        ),
        facts(pairs),
        view.problem ? el('p', { class: 'card-problem' }, view.problem) : null,
        parameters.length > 0
            ? el('div', {}, el('p', { class: 'card-label', style: 'margin:10px 0 0' }, 'Parameters'), el('ul', { class: 'params' }, ...parameters.map(([name, value]) => param(name, value))))
            : null,
    );
});
