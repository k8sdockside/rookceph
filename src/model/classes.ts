// Storage classes, and what each one actually hands you.
//
// This is the part of the plugin that has to work on a cluster with no Rook
// in it at all. A cluster can be a pure *client*: ceph-csi drivers, a handful
// of StorageClasses pointing at a Ceph somewhere else, and not one custom
// resource. The only thing that gives it away is a provisioner name, so the
// provisioner is what everything here is worked out from.
//
// Rook names its drivers after the namespace its operator runs in --
// `rook-ceph.rbd.csi.ceph.com` -- and a hand-rolled ceph-csi may name them
// anything at all, though `rbd.csi.ceph.com` and `cephfs.csi.ceph.com` are
// the defaults. So a class is matched on the *suffix*, never the whole name,
// and the prefix is kept because it is the operator's namespace and is how a
// class is tied back to the CephCluster it belongs to.
//
// The four kinds of Ceph storage class, and what the CSI driver gives a pod:
//
//   block   rbd.csi.ceph.com        an RBD image, one writer (RWO)
//   file    cephfs.csi.ceph.com     a CephFS subvolume, many writers (RWX)
//   nfs     nfs.csi.ceph.com        an NFS export of a CephFS subvolume
//   bucket  ceph.rook.io/bucket     an S3 bucket, through an ObjectBucketClaim

import type { CephBlockPool, CephCluster, CephFilesystem, CephNFS, CephObjectStore, PersistentVolumeClaim, StorageClass } from './rook.js';
import { quantity, type Tone } from './units.js';

export type ClassKind = 'block' | 'file' | 'nfs' | 'bucket' | 'other';

/** The driver suffixes, longest first so `nfs.csi.ceph.com` is not read as Ceph's `csi.ceph.com`. */
const SUFFIXES: { suffix: string; kind: ClassKind }[] = [
    { suffix: 'rbd.csi.ceph.com', kind: 'block' },
    { suffix: 'cephfs.csi.ceph.com', kind: 'file' },
    { suffix: 'nfs.csi.ceph.com', kind: 'nfs' },
    { suffix: 'ceph.rook.io/bucket', kind: 'bucket' },
];

/** How each kind is named to a person, and what it hands a workload. */
export const KIND_WORDS: Record<ClassKind, { label: string; short: string; gives: string }> = {
    block: { label: 'Block (RBD)', short: 'block', gives: 'an RBD image, mounted by one node at a time' },
    file: { label: 'Shared file (CephFS)', short: 'file', gives: 'a CephFS subvolume, mountable by many pods at once' },
    nfs: { label: 'NFS', short: 'nfs', gives: 'an NFS export of a CephFS subvolume' },
    bucket: { label: 'Object (S3 bucket)', short: 'bucket', gives: 'an S3 bucket, asked for with an ObjectBucketClaim' },
    other: { label: 'Other', short: 'other', gives: 'something this plugin does not recognise' },
};

/** The order the storage class page puts the kinds in. */
export const KIND_ORDER: ClassKind[] = ['block', 'file', 'nfs', 'bucket', 'other'];

/** Whether a provisioner is a Ceph one at all, and which sort. */
export function kindOf(provisioner: string): ClassKind | null {
    for (const { suffix, kind } of SUFFIXES) {
        if (provisioner === suffix || provisioner.endsWith(`.${suffix}`)) return kind;
    }
    return null;
}

/**
 * The namespace a Rook driver names itself after -- which is the namespace
 * its operator runs in, and usually the CephCluster's too. '' for a plain
 * ceph-csi driver with no prefix.
 */
export function driverNamespace(provisioner: string): string {
    for (const { suffix } of SUFFIXES) {
        if (provisioner.endsWith(`.${suffix}`)) return provisioner.slice(0, provisioner.length - suffix.length - 1);
    }
    return '';
}

/** What a Ceph storage class points at, once its parameters have been read. */
export interface Backing {
    /** `clusterID`: the namespace of the CephCluster, for a Rook-made class. */
    clusterID: string;
    /** The RBD pool, or the CephFS data pool. */
    pool: string;
    /** An erasure-coded data pool behind a replicated metadata pool, for RBD. */
    dataPool: string;
    /** The CephFS filesystem name. */
    fsName: string;
    /** The CephNFS resource name, and the server address the class mounts. */
    nfsCluster: string;
    server: string;
    /** The object store an ObjectBucketClaim's bucket is made in. */
    objectStore: string;
    objectStoreNamespace: string;
    /**
     * An RGW address given straight to the bucket provisioner. With one set,
     * Rook skips looking up the CephObjectStore altogether -- see the note in
     * `problemOf` -- so a class that has it needs no CR.
     */
    endpoint: string;
    /** Whether volumes are encrypted at rest by the CSI driver. */
    encrypted: boolean;
    /** The filesystem the driver formats a block volume with. */
    fsType: string;
    imageFeatures: string;
}

export interface ClassView {
    storageClass: StorageClass;
    name: string;
    kind: ClassKind;
    provisioner: string;
    /** The namespace in the driver name: `rook-ceph` from `rook-ceph.rbd.csi.ceph.com`. */
    driverNamespace: string;
    isDefault: boolean;
    reclaim: string;
    binding: string;
    expansion: boolean;
    backing: Backing;
    /** The CephCluster this class provisions from, when it is in this cluster. */
    cluster: CephCluster | null;
    /** The pool, filesystem, object store or NFS server behind it, when it is here. */
    pool: CephBlockPool | null;
    filesystem: CephFilesystem | null;
    objectStore: CephObjectStore | null;
    nfs: CephNFS | null;
    /** Claims bound to this class, and what they add up to. */
    claims: number;
    pending: number;
    requested: number;
    /** Why this class may not work, when something is plainly missing. */
    problem: string;
    tone: Tone;
}

const DEFAULT_ANNOTATIONS = ['storageclass.kubernetes.io/is-default-class', 'storageclass.beta.kubernetes.io/is-default-class'];

export function isDefault(storageClass: StorageClass): boolean {
    const annotations = storageClass.metadata.annotations ?? {};
    return DEFAULT_ANNOTATIONS.some((key) => annotations[key] === 'true');
}

function backingOf(parameters: Record<string, string> | null | undefined): Backing {
    const p = parameters ?? {};
    return {
        clusterID: p['clusterID'] ?? '',
        pool: p['pool'] ?? '',
        dataPool: p['dataPool'] ?? '',
        fsName: p['fsName'] ?? '',
        nfsCluster: p['nfsCluster'] ?? '',
        server: p['server'] ?? '',
        objectStore: p['objectStoreName'] ?? '',
        objectStoreNamespace: p['objectStoreNamespace'] ?? '',
        endpoint: p['endpoint'] ?? '',
        encrypted: p['encrypted'] === 'true',
        fsType: p['csi.storage.k8s.io/fstype'] ?? '',
        imageFeatures: p['imageFeatures'] ?? '',
    };
}

export interface Backends {
    clusters: CephCluster[];
    pools: CephBlockPool[];
    filesystems: CephFilesystem[];
    objectStores: CephObjectStore[];
    nfses: CephNFS[];
    claims: PersistentVolumeClaim[];
}

export const NO_BACKENDS: Backends = { clusters: [], pools: [], filesystems: [], objectStores: [], nfses: [], claims: [] };

/**
 * Every Ceph storage class in the cluster, tied to what it provisions from.
 *
 * `clusterID` is a namespace, not a name, which is why the CephCluster is
 * looked up by namespace: Rook puts exactly one CephCluster in a namespace,
 * and the CSI driver is told the namespace rather than the resource's name.
 */
export function classViews(storageClasses: StorageClass[], backends: Backends = NO_BACKENDS): ClassView[] {
    return storageClasses
        .map((storageClass) => classView(storageClass, backends))
        .filter((view): view is ClassView => view !== null)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

export function classView(storageClass: StorageClass, backends: Backends = NO_BACKENDS): ClassView | null {
    const provisioner = storageClass.provisioner ?? '';
    const kind = kindOf(provisioner);
    if (kind === null) return null;

    const backing = backingOf(storageClass.parameters);
    const name = storageClass.metadata.name;
    const namespace = backing.clusterID || driverNamespace(provisioner);

    const cluster = backends.clusters.find((c) => (c.metadata.namespace ?? '') === namespace) ?? null;
    const pool = backing.pool ? (backends.pools.find((p) => poolName(p) === backing.pool) ?? null) : null;
    const filesystem = backing.fsName ? (backends.filesystems.find((f) => f.metadata.name === backing.fsName) ?? null) : null;
    const objectStore = backing.objectStore
        ? (backends.objectStores.find(
              (o) => o.metadata.name === backing.objectStore && (!backing.objectStoreNamespace || (o.metadata.namespace ?? '') === backing.objectStoreNamespace),
          ) ?? null)
        : null;
    const nfs = backing.nfsCluster ? (backends.nfses.find((n) => n.metadata.name === backing.nfsCluster) ?? null) : null;

    const mine = backends.claims.filter((claim) => claim.spec?.storageClassName === name);
    const pending = mine.filter((claim) => (claim.status?.phase ?? '') === 'Pending').length;
    const requested = mine.reduce((total, claim) => total + quantity(claim.status?.capacity?.['storage'] ?? claim.spec?.resources?.requests?.['storage']), 0);

    const problem = problemOf(kind, backing, { cluster, pool, filesystem, objectStore, nfs }, backends);

    return {
        storageClass,
        name,
        kind,
        provisioner,
        driverNamespace: driverNamespace(provisioner),
        isDefault: isDefault(storageClass),
        reclaim: storageClass.reclaimPolicy ?? 'Delete',
        binding: storageClass.volumeBindingMode ?? 'Immediate',
        expansion: storageClass.allowVolumeExpansion === true,
        backing,
        cluster,
        pool,
        filesystem,
        objectStore,
        nfs,
        claims: mine.length,
        pending,
        requested,
        problem,
        tone: problem ? 'warn' : pending > 0 ? 'warn' : 'ok',
    };
}

/** A CephBlockPool's pool name: `spec.name` when it overrides the resource's own. */
export function poolName(pool: CephBlockPool): string {
    return pool.spec?.name || pool.metadata.name;
}

/**
 * What is plainly wrong with a class, in one sentence -- or '' when nothing is.
 *
 * The honest cases only. A class whose CephCluster is not in this cluster is
 * *not* broken: that is exactly what a client-only cluster looks like, and
 * saying "missing" about it would be wrong on every such cluster. Neither is a
 * class backed by an *external* CephCluster, whose pools and filesystems were
 * made on the Ceph outside and never have a CR here. It is only called out
 * when Rook owns the Ceph and the thing the class names is not there.
 */
function problemOf(
    kind: ClassKind,
    backing: Backing,
    found: { cluster: CephCluster | null; pool: CephBlockPool | null; filesystem: CephFilesystem | null; objectStore: CephObjectStore | null; nfs: CephNFS | null },
    backends: Backends,
): string {
    // Nothing of Rook's is in this cluster: every class here is a client's,
    // and there is nothing to check it against.
    const rookIsHere = backends.clusters.length > 0;
    if (!rookIsHere) return '';

    if (found.cluster === null) {
        return backing.clusterID
            ? `No CephCluster in namespace ${backing.clusterID}: this class provisions from a Ceph outside this cluster, or from one that has been removed.`
            : '';
    }
    // An external CephCluster only ever *connects* to a Ceph; it does not own
    // it. Rook's own import-external-cluster.sh creates StorageClasses and
    // nothing else, so the pools and filesystems behind them have no CR here
    // to find -- and ceph-csi does not want one: it talks to Ceph with the
    // clusterID and the pool or filesystem name straight off the class. Their
    // absence is the normal state of an external cluster, not a fault.
    //
    // Buckets are the exception, and are left to the check below. They are
    // not provisioned by ceph-csi but by Rook's own bucket provisioner, which
    // does read the CephObjectStore -- so there, a missing one is real.
    if (found.cluster.spec?.external?.enable === true && kind !== 'bucket') return '';

    if (kind === 'block' && backing.pool && found.pool === null) {
        return `No CephBlockPool named ${backing.pool}. Volumes will stay Pending unless the pool was made outside Rook.`;
    }
    if (kind === 'file' && backing.fsName && found.filesystem === null) {
        return `No CephFilesystem named ${backing.fsName}. Volumes will stay Pending unless the filesystem was made outside Rook.`;
    }
    // `endpoint` is Rook's backward-compatible path for an object store
    // outside the cluster: given one, the provisioner uses it and never looks
    // the CephObjectStore up, so its absence breaks nothing.
    if (kind === 'bucket' && backing.objectStore && found.objectStore === null && !backing.endpoint) {
        return `No CephObjectStore named ${backing.objectStore}. Bucket claims will stay Pending unless the class names an endpoint instead.`;
    }
    if (kind === 'nfs' && backing.nfsCluster && found.nfs === null) {
        return `No CephNFS named ${backing.nfsCluster}. Volumes will stay Pending.`;
    }
    return '';
}

/** The classes of one kind, for the page's sections. */
export function ofKind(views: ClassView[], kind: ClassKind): ClassView[] {
    return views.filter((view) => view.kind === kind);
}

/**
 * Whether this cluster consumes Ceph at all -- the question the overview asks
 * before it says "Rook is not installed here". A cluster with Ceph storage
 * classes and no operator is a client, and the plugin has plenty to show it.
 */
export function consumesCeph(storageClasses: StorageClass[]): boolean {
    return storageClasses.some((storageClass) => kindOf(storageClass.provisioner ?? '') !== null);
}
