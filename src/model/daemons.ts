// The Ceph daemons, read off the pods Rook runs them in.
//
// Rook labels every daemon pod with `app: rook-ceph-<type>` and the cluster's
// namespace under `rook_cluster`, and gives the OSDs three more the others do
// not have: `ceph-osd-id`, `device-class` and `failure-domain`. That is
// enough to draw the thing an operator actually wants -- which machine holds
// which OSD, in which failure domain -- without asking Ceph anything.
//
// An external cluster has none of these pods, and that is correct rather than
// broken: the daemons are running on somebody else's machines. A page must
// say so instead of drawing an empty grid.

import { APP, CLUSTER_LABEL, DAEMON_ID_LABEL, DEVICE_CLASS_LABEL, FAILURE_DOMAIN_LABEL, MGR_ROLE_LABEL, OSD_ID_LABEL, type Pod } from './rook.js';
import type { Tone } from './units.js';

export type DaemonType = 'mon' | 'mgr' | 'osd' | 'mds' | 'rgw' | 'nfs' | 'rbd-mirror' | 'exporter' | 'crash' | 'operator' | 'other';

/** The app label of each type, and how it is named to a person. */
export const DAEMONS: { type: DaemonType; app: string; label: string; note: string }[] = [
    { type: 'mon', app: APP.mon, label: 'Monitors', note: 'hold the maps every client and daemon reads; a quorum of them must be up' },
    { type: 'mgr', app: APP.mgr, label: 'Managers', note: 'run the dashboard, the metrics and the balancer; one is active, the rest stand by' },
    { type: 'osd', app: APP.osd, label: 'OSDs', note: 'one per disk: this is where the data is' },
    { type: 'mds', app: APP.mds, label: 'Metadata servers', note: 'serve CephFS; each filesystem has active ones and standbys' },
    { type: 'rgw', app: APP.rgw, label: 'Object gateways', note: 'the S3 endpoint in front of an object store' },
    { type: 'nfs', app: APP.nfs, label: 'NFS servers', note: 'export CephFS over NFS' },
    { type: 'rbd-mirror', app: APP.rbdMirror, label: 'RBD mirrors', note: 'copy block pools to another Ceph cluster' },
    { type: 'exporter', app: APP.exporter, label: 'Exporters', note: 'per-node Ceph metrics' },
    { type: 'crash', app: APP.crash, label: 'Crash collectors', note: 'keep crash reports from the daemons on each node' },
    { type: 'operator', app: APP.operator, label: 'Operator', note: 'Rook itself: it makes every other pod here' },
];

export interface DaemonView {
    pod: Pod;
    type: DaemonType;
    name: string;
    namespace: string;
    node: string;
    /** The daemon's id in Ceph's terms: `a` for a mon, `3` for an OSD. */
    id: string;
    /** OSDs only: the device class Ceph put the disk in -- hdd, ssd, nvme. */
    deviceClass: string;
    /** OSDs only: the CRUSH failure domain the OSD is in, usually the host. */
    failureDomain: string;
    /** Managers only: `active` or `standby`. */
    role: string;
    phase: string;
    ready: boolean;
    restarts: number;
    /** Why it is not running, when it is not. */
    problem: string;
    tone: Tone;
    startedAt: string;
}

/** Which daemon a pod is, from its `app` label. */
export function typeOf(pod: Pod): DaemonType {
    const app = pod.metadata.labels?.['app'] ?? '';
    // The OSD prepare jobs carry their own app label and are not daemons:
    // they run once per disk and then stop, and counting them as OSDs would
    // double every number on the page.
    if (app === APP.osdPrepare) return 'other';
    const found = DAEMONS.find((daemon) => daemon.app === app);
    return found?.type ?? 'other';
}

export function daemonView(pod: Pod): DaemonView {
    const labels = pod.metadata.labels ?? {};
    const type = typeOf(pod);
    const statuses = pod.status?.containerStatuses ?? [];
    const phase = pod.status?.phase ?? '';
    const ready = statuses.length > 0 && statuses.every((container) => container.ready === true);
    const restarts = statuses.reduce((n, container) => n + (container.restartCount ?? 0), 0);
    const problem = problemOf(pod, phase, ready, statuses);

    return {
        pod,
        type,
        name: pod.metadata.name,
        namespace: pod.metadata.namespace ?? '',
        node: pod.spec?.nodeName ?? '',
        id: labels[OSD_ID_LABEL] ?? labels[DAEMON_ID_LABEL] ?? '',
        deviceClass: labels[DEVICE_CLASS_LABEL] ?? '',
        failureDomain: labels[FAILURE_DOMAIN_LABEL] ?? '',
        role: labels[MGR_ROLE_LABEL] ?? '',
        phase,
        ready,
        restarts,
        problem,
        tone: phase === 'Running' && ready ? 'ok' : phase === 'Failed' ? 'error' : problem ? 'warn' : '',
        startedAt: pod.status?.startTime ?? '',
    };
}

function problemOf(pod: Pod, phase: string, ready: boolean, statuses: NonNullable<NonNullable<Pod['status']>['containerStatuses']>): string {
    if (phase === 'Running' && ready) return '';
    for (const container of statuses) {
        const waiting = container.state?.waiting;
        if (waiting?.reason) return waiting.message || waiting.reason;
        const terminated = container.state?.terminated;
        if (terminated?.reason && terminated.reason !== 'Completed') return `${terminated.reason} (exit ${terminated.exitCode ?? '?'})`;
    }
    if (pod.status?.reason) return pod.status.reason;
    if (pod.status?.message) return pod.status.message;
    if (phase === 'Pending') return 'the pod has not been scheduled or its image is still being pulled';
    if (phase === 'Running' && !ready) return 'the pod is running but has not reported itself ready';
    return '';
}

export interface DaemonGroup {
    type: DaemonType;
    label: string;
    note: string;
    daemons: DaemonView[];
    running: number;
    total: number;
    tone: Tone;
}

/** The daemons of a cluster, grouped by type in the order above. */
export function groups(pods: Pod[]): DaemonGroup[] {
    const views = pods.map(daemonView);
    return DAEMONS.map(({ type, label, note }) => {
        const daemons = views.filter((daemon) => daemon.type === type).sort(byDaemon);
        const running = daemons.filter((daemon) => daemon.tone === 'ok').length;
        return {
            type,
            label,
            note,
            daemons,
            running,
            total: daemons.length,
            tone: (daemons.length === 0 ? '' : running === daemons.length ? 'ok' : running === 0 ? 'error' : 'warn') as Tone,
        };
    }).filter((group) => group.total > 0);
}

/**
 * OSDs by id, everything else by name.
 *
 * `localeCompare` with `numeric` is what keeps osd.10 after osd.9 rather than
 * between osd.1 and osd.2, which is the sort every Ceph tool uses and the one
 * anyone reading a list of OSDs expects.
 */
function byDaemon(a: DaemonView, b: DaemonView): number {
    if (a.id && b.id) return a.id.localeCompare(b.id, undefined, { numeric: true });
    return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/** The daemons on one machine, for the panel on a Node. */
export function onNode(pods: Pod[], node: string): DaemonView[] {
    return pods
        .map(daemonView)
        .filter((daemon) => daemon.node === node && daemon.type !== 'other')
        .sort((a, b) => DAEMONS.findIndex((d) => d.type === a.type) - DAEMONS.findIndex((d) => d.type === b.type) || byDaemon(a, b));
}

/** The pods of one CephCluster, by the namespace label Rook stamps on them. */
export function ofCluster(pods: Pod[], namespace: string): Pod[] {
    return pods.filter((pod) => (pod.metadata.labels?.[CLUSTER_LABEL] ?? pod.metadata.namespace ?? '') === namespace);
}

/** How many machines hold OSDs, and how many OSDs the fullest of them holds. */
export function osdSpread(daemons: DaemonView[]): { nodes: number; most: number } {
    const perNode = new Map<string, number>();
    for (const daemon of daemons) {
        if (daemon.type !== 'osd' || !daemon.node) continue;
        perNode.set(daemon.node, (perNode.get(daemon.node) ?? 0) + 1);
    }
    return { nodes: perNode.size, most: Math.max(0, ...perNode.values()) };
}
