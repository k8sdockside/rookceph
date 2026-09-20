// What is wrong, worst first, in words and with something to open.
//
// The dashboard's bottom half. Rings say how many; this says which, and why,
// and gets you there. The ordering is by how much it matters, not by which
// list it came out of, because a HEALTH_ERR check and a CrashLoopBackOff mon
// are the same problem seen from two sides and belong next to each other.

import { poolName, type ClassView } from './classes.js';
import type { ClusterView } from './health.js';
import { fullnessTone } from './health.js';
import type { DaemonView } from './daemons.js';
import { durability, fragile, type CephBlockPool, type CephFilesystem, type CephObjectStore } from './rook.js';
import { BLOCK_POOLS, CLUSTERS, FILESYSTEMS, OBJECT_STORES, PODS, STORAGE_CLASSES } from './rook.js';
import { percent, size, type Tone } from './units.js';

export interface Issue {
    title: string;
    detail: string;
    tone: Tone;
    /** How bad: 0 is worst. Only used for the order. */
    rank: number;
    ref: K8sDockside.ObjectRef;
}

/** The phases Rook writes when a resource is fine. Anything else is worth saying. */
const SETTLED = new Set(['Ready', 'Connected', 'Connecting', 'Progressing', '']);
const HEALTHY = new Set(['Ready', 'Connected']);

export interface Sources {
    clusters: ClusterView[];
    daemons: DaemonView[];
    pools: CephBlockPool[];
    filesystems: CephFilesystem[];
    objectStores: CephObjectStore[];
    classes: ClassView[];
}

/** Everything that needs attention, worst first. */
export function issues(sources: Sources): Issue[] {
    const found: Issue[] = [
        ...clusterIssues(sources.clusters),
        ...daemonIssues(sources.daemons),
        ...poolIssues(sources.pools),
        ...filesystemIssues(sources.filesystems),
        ...objectStoreIssues(sources.objectStores),
        ...classIssues(sources.classes),
    ];
    return found.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

function clusterIssues(clusters: ClusterView[]): Issue[] {
    const found: Issue[] = [];
    for (const view of clusters) {
        const ref: K8sDockside.ObjectRef = { kind: CLUSTERS, namespace: view.namespace, name: view.name };

        // Every Ceph health check, as Ceph itself words it. These are the most
        // useful lines on the page: they are what `ceph status` would tell you.
        for (const check of view.checks) {
            found.push({
                title: `${view.name}: ${check.id}`,
                detail: check.message || check.severity,
                tone: check.tone,
                rank: check.tone === 'error' ? 0 : 2,
                ref,
            });
        }

        if (view.cleanup) {
            found.push({
                title: `${view.name} is being destroyed`,
                detail: `spec.cleanupPolicy.confirmation is set to "${view.cleanup}". Rook will wipe the data on the hosts when the cluster is deleted.`,
                tone: 'error',
                rank: 0,
                ref,
            });
        }
        if (view.phase && !SETTLED.has(view.phase)) {
            found.push({
                title: `${view.name} is in phase ${view.phase}`,
                detail: view.message || 'Rook could not finish reconciling the cluster.',
                tone: 'error',
                rank: 1,
                ref,
            });
        }
        if (view.capacity.known) {
            const tone = fullnessTone(view.capacity);
            if (tone === 'error' || tone === 'warn') {
                found.push({
                    title: `${view.name} is ${percent(view.capacity.used, view.capacity.total).toFixed(0)}% full`,
                    detail: `${size(view.capacity.used)} of ${size(view.capacity.total)} raw. Ceph stops accepting writes at its full ratio, which defaults to 95%.`,
                    tone,
                    rank: tone === 'error' ? 1 : 3,
                    ref,
                });
            }
        }
        if (!view.health && !view.external) {
            found.push({
                title: `${view.name} has not reported its status`,
                detail: 'Rook has not been able to read `ceph status` from the mons yet.',
                tone: 'warn',
                rank: 3,
                ref,
            });
        }
    }
    return found;
}

function daemonIssues(daemons: DaemonView[]): Issue[] {
    return daemons
        .filter((daemon) => daemon.tone === 'error' || daemon.tone === 'warn')
        .map((daemon) => ({
            title: `${daemon.name} is ${daemon.phase.toLowerCase() || 'not running'}`,
            detail: daemon.problem || `The pod is ${daemon.phase || 'in an unknown state'}.`,
            tone: daemon.tone,
            rank: daemon.type === 'mon' || daemon.type === 'osd' ? 1 : 2,
            ref: { kind: PODS, namespace: daemon.namespace, name: daemon.name },
        }));
}

function poolIssues(pools: CephBlockPool[]): Issue[] {
    const found: Issue[] = [];
    for (const pool of pools) {
        const ref: K8sDockside.ObjectRef = { kind: BLOCK_POOLS, namespace: pool.metadata.namespace ?? '', name: pool.metadata.name };
        const phase = pool.status?.phase ?? '';
        if (phase && !HEALTHY.has(phase)) {
            found.push({ title: `Pool ${poolName(pool)} is in phase ${phase}`, detail: 'Rook has not been able to make or update the pool.', tone: 'error', rank: 1, ref });
        }
        if (fragile(pool.spec)) {
            found.push({
                title: `Pool ${poolName(pool)} has no redundancy`,
                detail: `${durability(pool.spec) || 'Its layout'} means one failed OSD loses the data in this pool.`,
                tone: 'warn',
                rank: 3,
                ref,
            });
        }
        const mirror = pool.status?.mirroringStatus?.summary?.health ?? '';
        if (mirror && mirror !== 'OK') {
            found.push({
                title: `Mirroring on ${poolName(pool)} is ${mirror}`,
                detail: pool.status?.mirroringStatus?.details || 'The mirror daemon is not keeping up with the peer cluster.',
                tone: mirror === 'ERROR' ? 'error' : 'warn',
                rank: 2,
                ref,
            });
        }
    }
    return found;
}

function filesystemIssues(filesystems: CephFilesystem[]): Issue[] {
    return filesystems
        .filter((fs) => (fs.status?.phase ?? '') !== '' && !HEALTHY.has(fs.status?.phase ?? ''))
        .map((fs) => ({
            title: `Filesystem ${fs.metadata.name} is in phase ${fs.status?.phase}`,
            detail: 'Rook has not been able to make or update the filesystem and its metadata servers.',
            tone: 'error' as Tone,
            rank: 1,
            ref: { kind: FILESYSTEMS, namespace: fs.metadata.namespace ?? '', name: fs.metadata.name },
        }));
}

function objectStoreIssues(stores: CephObjectStore[]): Issue[] {
    return stores
        .filter((store) => (store.status?.phase ?? '') !== '' && !HEALTHY.has(store.status?.phase ?? ''))
        .map((store) => ({
            title: `Object store ${store.metadata.name} is in phase ${store.status?.phase}`,
            detail: store.status?.message || 'The RGW gateways are not serving.',
            tone: 'error' as Tone,
            rank: 1,
            ref: { kind: OBJECT_STORES, namespace: store.metadata.namespace ?? '', name: store.metadata.name },
        }));
}

function classIssues(classes: ClassView[]): Issue[] {
    const found: Issue[] = [];
    for (const view of classes) {
        const ref: K8sDockside.ObjectRef = { kind: STORAGE_CLASSES, name: view.name };
        if (view.problem) {
            found.push({ title: `Storage class ${view.name} points at nothing`, detail: view.problem, tone: 'warn', rank: 2, ref });
        }
        if (view.pending > 0) {
            found.push({
                title: `${view.pending} claim${view.pending === 1 ? '' : 's'} on ${view.name} ${view.pending === 1 ? 'is' : 'are'} pending`,
                detail: 'The CSI provisioner has not made the volumes yet. Open the claims to see what it says.',
                tone: 'warn',
                rank: 3,
                ref,
            });
        }
    }
    return found;
}
