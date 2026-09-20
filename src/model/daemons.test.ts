import { describe, expect, it } from 'vitest';
import { daemonView, groups, ofCluster, onNode, osdSpread, typeOf } from './daemons.js';
import type { Pod } from './rook.js';

function pod(name: string, labels: Record<string, string>, node = 'node-1', status: Pod['status'] = { phase: 'Running', containerStatuses: [{ name: 'c', ready: true, restartCount: 0 }] }): Pod {
    return { metadata: { name, namespace: 'rook-ceph', labels }, spec: { nodeName: node }, status };
}

describe('typeOf', () => {
    it('reads the app label Rook stamps on every daemon', () => {
        expect(typeOf(pod('a', { app: 'rook-ceph-mon' }))).toBe('mon');
        expect(typeOf(pod('a', { app: 'rook-ceph-osd' }))).toBe('osd');
        expect(typeOf(pod('a', { app: 'rook-ceph-mgr' }))).toBe('mgr');
        expect(typeOf(pod('a', { app: 'rook-ceph-mds' }))).toBe('mds');
        expect(typeOf(pod('a', { app: 'rook-ceph-rgw' }))).toBe('rgw');
    });

    // The prepare jobs share the OSD's shape and would double every OSD
    // number on the page. They are not daemons: they run once and stop.
    it('does not count the OSD prepare jobs as OSDs', () => {
        expect(typeOf(pod('prep', { app: 'rook-ceph-osd-prepare' }))).toBe('other');
    });

    it('does not guess about a pod that is not Rook s', () => {
        expect(typeOf(pod('nginx', { app: 'nginx' }))).toBe('other');
        expect(typeOf(pod('bare', {}))).toBe('other');
    });
});

describe('daemonView', () => {
    it('reads an OSD s id, device class and failure domain off its labels', () => {
        const view = daemonView(pod('rook-ceph-osd-3-abc', { app: 'rook-ceph-osd', 'ceph-osd-id': '3', 'device-class': 'nvme', 'failure-domain': 'node-2' }, 'node-2'));
        expect(view).toMatchObject({ type: 'osd', id: '3', deviceClass: 'nvme', failureDomain: 'node-2', node: 'node-2', tone: 'ok' });
    });

    it('reads which manager is the active one', () => {
        expect(daemonView(pod('mgr-a', { app: 'rook-ceph-mgr', mgr_role: 'active' })).role).toBe('active');
        expect(daemonView(pod('mgr-b', { app: 'rook-ceph-mgr', mgr_role: 'standby' })).role).toBe('standby');
    });

    it('says why a daemon is not running, in the container s own words', () => {
        const view = daemonView(
            pod('rook-ceph-osd-1-x', { app: 'rook-ceph-osd' }, 'node-1', {
                phase: 'Pending',
                containerStatuses: [{ name: 'osd', ready: false, restartCount: 0, state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off restarting' } } }],
            }),
        );
        expect(view.tone).toBe('warn');
        expect(view.problem).toBe('back-off restarting');
    });

    // "Running" and "ready" are different things, and a mon that is running
    // but not ready is not in the quorum.
    it('does not call a running but unready pod healthy', () => {
        const view = daemonView(pod('mon-a', { app: 'rook-ceph-mon' }, 'node-1', { phase: 'Running', containerStatuses: [{ name: 'mon', ready: false, restartCount: 0 }] }));
        expect(view.tone).not.toBe('ok');
        expect(view.problem).toContain('not reported itself ready');
    });

    it('adds up restarts across every container', () => {
        const view = daemonView(
            pod('mon-a', { app: 'rook-ceph-mon' }, 'node-1', {
                phase: 'Running',
                containerStatuses: [
                    { name: 'mon', ready: true, restartCount: 2 },
                    { name: 'watch', ready: true, restartCount: 1 },
                ],
            }),
        );
        expect(view.restarts).toBe(3);
    });
});

describe('groups', () => {
    const pods = [
        pod('mon-a', { app: 'rook-ceph-mon', ceph_daemon_id: 'a' }),
        pod('mon-b', { app: 'rook-ceph-mon', ceph_daemon_id: 'b' }),
        pod('osd-0', { app: 'rook-ceph-osd', 'ceph-osd-id': '0' }),
        pod('osd-10', { app: 'rook-ceph-osd', 'ceph-osd-id': '10' }),
        pod('osd-2', { app: 'rook-ceph-osd', 'ceph-osd-id': '2' }),
        pod('prep', { app: 'rook-ceph-osd-prepare' }),
        pod('nginx', { app: 'nginx' }),
    ];

    it('keeps only the daemon groups that have anything in them', () => {
        expect(groups(pods).map((group) => group.type)).toEqual(['mon', 'osd']);
    });

    // osd.10 goes after osd.9, not between osd.1 and osd.2. Every Ceph tool
    // sorts this way and a page that does not looks broken.
    it('sorts OSDs by number, not by string', () => {
        const osds = groups(pods).find((group) => group.type === 'osd');
        expect(osds?.daemons.map((daemon) => daemon.id)).toEqual(['0', '2', '10']);
    });

    it('counts what is running against what there is', () => {
        const mons = groups(pods).find((group) => group.type === 'mon');
        expect(mons).toMatchObject({ running: 2, total: 2, tone: 'ok' });
    });

    it('turns the group red only when nothing in it is up', () => {
        const down = pod('osd-9', { app: 'rook-ceph-osd', 'ceph-osd-id': '9' }, 'node-1', { phase: 'Failed', containerStatuses: [] });
        expect(groups([down]).find((group) => group.type === 'osd')?.tone).toBe('error');
        expect(groups([down, pod('osd-8', { app: 'rook-ceph-osd', 'ceph-osd-id': '8' })]).find((group) => group.type === 'osd')?.tone).toBe('warn');
    });
});

describe('onNode', () => {
    it('gives one machine s daemons, and leaves other pods out', () => {
        const pods = [
            pod('mon-a', { app: 'rook-ceph-mon' }, 'node-1'),
            pod('osd-0', { app: 'rook-ceph-osd', 'ceph-osd-id': '0' }, 'node-1'),
            pod('osd-1', { app: 'rook-ceph-osd', 'ceph-osd-id': '1' }, 'node-2'),
            pod('nginx', { app: 'nginx' }, 'node-1'),
        ];
        expect(onNode(pods, 'node-1').map((daemon) => daemon.name)).toEqual(['mon-a', 'osd-0']);
    });
});

describe('ofCluster', () => {
    it('picks the pods of one CephCluster by the namespace label Rook stamps on', () => {
        const pods: Pod[] = [
            { metadata: { name: 'a', namespace: 'rook-ceph', labels: { app: 'rook-ceph-mon', rook_cluster: 'rook-ceph' } } },
            { metadata: { name: 'b', namespace: 'other', labels: { app: 'rook-ceph-mon', rook_cluster: 'other-ceph' } } },
        ];
        expect(ofCluster(pods, 'rook-ceph').map((p) => p.metadata.name)).toEqual(['a']);
    });
});

describe('osdSpread', () => {
    it('counts the machines and the fullest one, which is what a CRUSH rule cares about', () => {
        const osds = [
            daemonView(pod('osd-0', { app: 'rook-ceph-osd', 'ceph-osd-id': '0' }, 'node-1')),
            daemonView(pod('osd-1', { app: 'rook-ceph-osd', 'ceph-osd-id': '1' }, 'node-1')),
            daemonView(pod('osd-2', { app: 'rook-ceph-osd', 'ceph-osd-id': '2' }, 'node-2')),
        ];
        expect(osdSpread(osds)).toEqual({ nodes: 2, most: 2 });
    });

    it('is zero rather than -Infinity when there are no OSDs at all', () => {
        expect(osdSpread([])).toEqual({ nodes: 0, most: 0 });
    });
});
