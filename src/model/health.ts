// What a CephCluster is, how it is, and how much room it has.
//
// Ceph answers "how is it" with one of three words -- HEALTH_OK, HEALTH_WARN,
// HEALTH_ERR -- and a list of checks that explain the other two. Rook copies
// both into `status.ceph`, so the plugin never has to run `ceph status`.
//
// Two things are worth knowing before reading this:
//
//  1. An *external* cluster -- `spec.external.enable` -- is Ceph running
//     somewhere else, which this cluster only consumes. Rook still fills in
//     health and capacity from the mons it was given, but there are no OSD
//     pods here to look at and nothing here to fix. Saying "0 OSDs" about one
//     would be a lie, so the mode is carried on every view that says it.
//  2. `status.ceph` is absent until Rook has talked to the mons once. That is
//     not "unhealthy", it is "not known yet", and the two must not look the
//     same: a fresh install would be drawn as a cluster in trouble.

import type { CephCluster, CephHealthMessage } from './rook.js';
import type { Tone } from './units.js';

export type Mode = 'converged' | 'external';

/** One check Ceph is complaining about. */
export interface HealthCheck {
    /** The check's id: MON_DOWN, OSD_NEARFULL, POOL_APP_NOT_ENABLED ... */
    id: string;
    severity: string;
    message: string;
    tone: Tone;
}

export interface ClusterView {
    cluster: CephCluster;
    name: string;
    namespace: string;
    mode: Mode;
    /** True when Ceph runs outside this Kubernetes cluster. */
    external: boolean;
    /** HEALTH_OK, HEALTH_WARN, HEALTH_ERR, or '' when Rook has not looked yet. */
    health: string;
    /** The health word without its HEALTH_ prefix, lowercased: ok, warn, err, unknown. */
    word: string;
    tone: Tone;
    /** Rook's own phase for the resource: Ready, Progressing, Failure, Connected ... */
    phase: string;
    message: string;
    fsid: string;
    version: string;
    image: string;
    checks: HealthCheck[];
    capacity: Capacity;
    /** Device classes Ceph has OSDs in: hdd, ssd, nvme. */
    deviceClasses: string[];
    /** OSD backing store -> how many OSDs use it, e.g. { bluestore: 6 }. */
    stores: Record<string, number>;
    /** How many mons the spec asks for. 0 for an external cluster. */
    monsWanted: number;
    /** Ceph version -> daemon count, per daemon type, as the mons report it. */
    daemonVersions: { type: string; versions: { version: string; count: number }[] }[];
    dashboard: boolean;
    /** Set when the cluster is being wiped on purpose. */
    cleanup: string;
}

export interface Capacity {
    total: number;
    used: number;
    available: number;
    /** Whether Ceph has reported any capacity at all. */
    known: boolean;
    lastUpdated: string;
}

export const NO_CAPACITY: Capacity = { total: 0, used: 0, available: 0, known: false, lastUpdated: '' };

/** Everything a page needs about one CephCluster, worked out once. */
export function clusterView(cluster: CephCluster): ClusterView {
    const ceph = cluster.status?.ceph ?? null;
    const health = ceph?.health ?? '';
    const external = cluster.spec?.external?.enable === true;

    return {
        cluster,
        name: cluster.metadata.name,
        namespace: cluster.metadata.namespace ?? '',
        mode: external ? 'external' : 'converged',
        external,
        health,
        word: healthWord(health),
        tone: healthTone(health),
        phase: cluster.status?.phase ?? cluster.status?.state ?? '',
        message: cluster.status?.message ?? '',
        fsid: ceph?.fsid ?? '',
        version: cluster.status?.version?.version ?? '',
        image: cluster.status?.version?.image ?? cluster.spec?.cephVersion?.image ?? '',
        checks: checks(ceph?.details),
        capacity: capacityOf(cluster),
        deviceClasses: (cluster.status?.storage?.deviceClasses ?? []).map((c) => c.name ?? '').filter((n) => n !== ''),
        stores: cluster.status?.storage?.osd?.storeType ?? {},
        monsWanted: external ? 0 : (cluster.spec?.mon?.count ?? 0),
        daemonVersions: daemonVersions(cluster),
        dashboard: cluster.spec?.dashboard?.enabled === true,
        cleanup: cluster.spec?.cleanupPolicy?.confirmation ?? '',
    };
}

/** HEALTH_WARN -> warn. '' -> unknown, which is not the same as bad. */
export function healthWord(health: string): string {
    switch (health) {
        case 'HEALTH_OK':
            return 'ok';
        case 'HEALTH_WARN':
            return 'warn';
        case 'HEALTH_ERR':
            return 'err';
        default:
            return health ? health.toLowerCase() : 'unknown';
    }
}

export function healthTone(health: string): Tone {
    switch (health) {
        case 'HEALTH_OK':
            return 'ok';
        case 'HEALTH_WARN':
            return 'warn';
        case 'HEALTH_ERR':
            return 'error';
        default:
            return '';
    }
}

/** What to say about a health word in a sentence, rather than as a label. */
export function healthSentence(view: ClusterView): string {
    switch (view.health) {
        case 'HEALTH_OK':
            return 'Ceph reports every check passing.';
        case 'HEALTH_WARN':
            return `Ceph is warning about ${view.checks.length === 1 ? 'one check' : `${view.checks.length} checks`}.`;
        case 'HEALTH_ERR':
            return `Ceph is in error on ${view.checks.length === 1 ? 'one check' : `${view.checks.length} checks`}.`;
        default:
            return 'Rook has not read the cluster status yet. That is not the same as a problem — give it a moment.';
    }
}

/**
 * Ceph's health checks, worst first.
 *
 * Rook stores them as a map keyed by the check id, and a map has no order, so
 * one is imposed here: errors before warnings, and the ids alphabetical
 * inside each, so the list does not reshuffle itself every ten seconds.
 */
export function checks(details: Record<string, CephHealthMessage> | null | undefined): HealthCheck[] {
    const rank = (severity: string): number => (severity === 'HEALTH_ERR' ? 0 : severity === 'HEALTH_WARN' ? 1 : 2);
    return Object.entries(details ?? {})
        .map(([id, detail]) => ({
            id,
            severity: detail?.severity ?? '',
            message: detail?.message ?? '',
            tone: healthTone(detail?.severity ?? ''),
        }))
        .sort((a, b) => rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id));
}

/**
 * What `ceph df` last said, as three numbers that do add up.
 *
 * Rook writes zeroes into `capacity` before it has ever read them, so a
 * cluster with a total of zero is one nothing is known about -- drawing it as
 * a full bar, or as "0 B of 0 B", is the difference between an honest page
 * and one that invents an outage.
 */
export function capacityOf(cluster: CephCluster): Capacity {
    const capacity = cluster.status?.ceph?.capacity;
    const total = capacity?.bytesTotal ?? 0;
    const used = capacity?.bytesUsed ?? 0;
    const available = capacity?.bytesAvailable ?? 0;
    if (!(total > 0)) return { ...NO_CAPACITY, lastUpdated: capacity?.lastUpdated ?? '' };
    return {
        total,
        used: Math.max(0, Math.min(used, total)),
        available: Math.max(0, Math.min(available, total)),
        known: true,
        lastUpdated: capacity?.lastUpdated ?? '',
    };
}

/** The tone for how full a cluster is. Ceph's own defaults are 85% and 95%. */
export function fullnessTone(capacity: Capacity): Tone {
    if (!capacity.known) return '';
    const share = capacity.used / capacity.total;
    if (share >= 0.95) return 'error';
    if (share >= 0.85) return 'warn';
    return 'ok';
}

/** The daemon versions the mons report, flattened for a table. */
function daemonVersions(cluster: CephCluster): { type: string; versions: { version: string; count: number }[] }[] {
    const versions = cluster.status?.ceph?.versions;
    if (!versions) return [];
    const types: [string, Record<string, number> | undefined][] = [
        ['mon', versions.mon],
        ['mgr', versions.mgr],
        ['osd', versions.osd],
        ['mds', versions.mds],
        ['rgw', versions.rgw],
    ];
    return types
        .filter(([, map]) => map && Object.keys(map).length > 0)
        .map(([type, map]) => ({
            type,
            versions: Object.entries(map ?? {})
                .map(([version, count]) => ({ version, count }))
                .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version)),
        }));
}

/**
 * Whether a cluster's daemons run more than one Ceph version at once.
 *
 * Mid-upgrade this is normal and expected; left that way for days it is the
 * thing that bites, so it is worth saying out loud rather than making someone
 * compare five version maps by eye.
 */
export function mixedVersions(view: ClusterView): boolean {
    const all = new Set<string>();
    for (const daemon of view.daemonVersions) for (const v of daemon.versions) all.add(v.version);
    return all.size > 1;
}
