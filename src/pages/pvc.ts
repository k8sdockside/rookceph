// The panel on a PersistentVolumeClaim: what Ceph gave it.
//
// A claim tells you almost nothing about the storage behind it -- a name, a
// size, a class. The interesting part is two hops away: the PV holds the CSI
// volume handle, and the handle is how you find the RBD image or the CephFS
// subvolume in Ceph itself. This panel makes those two hops so nobody has to
// open three YAML tabs to answer "which image is this".

import { classView, KIND_WORDS, poolName } from '../model/classes.js';
import {
    BLOCK_POOLS,
    CLUSTERS,
    FILESYSTEMS,
    NFSES,
    OBJECT_STORES,
    PVS,
    STORAGE_CLASSES,
    durability,
    type CephBlockPool,
    type CephCluster,
    type CephFilesystem,
    type CephNFS,
    type CephObjectStore,
    type PersistentVolume,
    type PersistentVolumeClaim,
    type StorageClass,
} from '../model/rook.js';
import { quantity, size } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { maybeList, start } from '../ui/page.js';
import { facts, nothing, openName, pill } from '../ui/parts.js';

start('panel', async () => {
    const host = byId('panel');
    const claim = await k8sdockside.object<PersistentVolumeClaim>();
    const className = claim.spec?.storageClassName ?? '';

    if (!className) {
        replace(host, nothing('This claim names no storage class, so nothing here can say whether Ceph is behind it.'));
        return;
    }

    const [storageClasses, volumes, clusters, pools, filesystems, objectStores, nfses] = await Promise.all([
        maybeList<StorageClass>({ kind: STORAGE_CLASSES }),
        maybeList<PersistentVolume>({ kind: PVS }),
        maybeList<CephCluster>({ kind: CLUSTERS }),
        maybeList<CephBlockPool>({ kind: BLOCK_POOLS }),
        maybeList<CephFilesystem>({ kind: FILESYSTEMS }),
        maybeList<CephObjectStore>({ kind: OBJECT_STORES }),
        maybeList<CephNFS>({ kind: NFSES }),
    ]);

    const storageClass = storageClasses.find((candidate) => candidate.metadata.name === className);
    const view = storageClass ? classView(storageClass, { clusters, pools, filesystems, objectStores, nfses, claims: [claim] }) : null;

    if (!view) {
        replace(
            host,
            nothing(
                storageClass
                    ? `${className} is not a Ceph storage class — its provisioner is ${storageClass.provisioner ?? 'not set'}.`
                    : `No storage class named ${className} is in this cluster any more.`,
            ),
        );
        return;
    }

    const volume = volumes.find((candidate) => candidate.metadata.name === (claim.spec?.volumeName ?? ''));
    const csi = volume?.spec?.csi;
    const attributes = csi?.volumeAttributes ?? {};

    const pairs: [string, Node | string][] = [
        ['What it is', `${KIND_WORDS[view.kind].label} — ${KIND_WORDS[view.kind].gives}`],
        ['Storage class', openName(view.name, { kind: STORAGE_CLASSES, name: view.name }, 'card-name')],
    ];

    if (view.cluster) {
        pairs.push(['Ceph cluster', openName(view.cluster.metadata.name, { kind: CLUSTERS, namespace: view.cluster.metadata.namespace ?? '', name: view.cluster.metadata.name }, 'card-name')]);
    } else if (view.backing.clusterID) {
        pairs.push(['Ceph cluster', el('span', { class: 'faint' }, `cluster id ${view.backing.clusterID}, outside this Kubernetes cluster`)]);
    }

    if (view.kind === 'block') {
        pairs.push(['Pool', view.pool ? openName(poolName(view.pool), { kind: BLOCK_POOLS, namespace: view.pool.metadata.namespace ?? '', name: view.pool.metadata.name }, 'card-name') : mono(view.backing.pool)]);
        // The RBD image name, which is what `rbd ls` would show and what every
        // Ceph-side command needs. ceph-csi puts it in the volume attributes.
        if (attributes['imageName']) pairs.push(['RBD image', mono(attributes['imageName'])]);
        if (view.pool) pairs.push(['Redundancy', durability(view.pool.spec) || '—']);
    }
    if (view.kind === 'file' || view.kind === 'nfs') {
        pairs.push(['Filesystem', view.filesystem ? openName(view.filesystem.metadata.name, { kind: FILESYSTEMS, namespace: view.filesystem.metadata.namespace ?? '', name: view.filesystem.metadata.name }, 'card-name') : mono(view.backing.fsName)]);
        if (attributes['subvolumeName']) pairs.push(['Subvolume', mono(attributes['subvolumeName'])]);
        if (attributes['subvolumePath']) pairs.push(['Path', mono(attributes['subvolumePath'])]);
        pairs.push(['Data pool', mono(view.backing.pool)]);
    }
    if (view.kind === 'nfs') {
        pairs.push(['NFS server', view.nfs ? openName(view.nfs.metadata.name, { kind: NFSES, namespace: view.nfs.metadata.namespace ?? '', name: view.nfs.metadata.name }, 'card-name') : mono(view.backing.nfsCluster)]);
    }
    if (view.kind === 'bucket') {
        pairs.push(['Object store', view.objectStore ? openName(view.objectStore.metadata.name, { kind: OBJECT_STORES, namespace: view.objectStore.metadata.namespace ?? '', name: view.objectStore.metadata.name }, 'card-name') : mono(view.backing.objectStore)]);
    }

    if (csi?.volumeHandle) pairs.push(['CSI volume handle', mono(csi.volumeHandle)]);
    pairs.push([
        'Size',
        el(
            'span',
            {},
            size(quantity(claim.status?.capacity?.['storage'] ?? claim.spec?.resources?.requests?.['storage'])),
            view.expansion ? el('span', { class: 'faint' }, ' — this class allows growing it') : el('span', { class: 'faint' }, ' — this class does not allow growing it'),
        ),
    ]);

    const phase = claim.status?.phase ?? '';
    replace(
        host,
        el(
            'div',
            { class: 'panel-head' },
            pill(phase || 'no phase', phase === 'Bound' ? 'ok' : phase === 'Pending' ? 'warn' : ''),
            view.backing.encrypted ? pill('encrypted', 'ok', 'The CSI driver encrypts this volume') : null,
            (claim.spec?.accessModes ?? []).map((mode) => pill(mode, '')).length > 0 ? el('span', {}, ...(claim.spec?.accessModes ?? []).map((mode) => pill(mode, ''))) : null,
            el('span', { class: 'spacer' }),
            el('span', { class: 'faint mono' }, view.provisioner),
        ),
        facts(pairs),
        phase === 'Pending' ? el('p', { class: 'card-problem' }, 'The CSI provisioner has not made this volume yet. Its events say why — and if the pool or filesystem the class names is missing, that is usually it.') : null,
        view.problem ? el('p', { class: 'card-problem' }, view.problem) : null,
    );
});

function mono(value: string): Node {
    return value ? el('span', { class: 'mono' }, value) : el('span', { class: 'faint' }, 'not set');
}
