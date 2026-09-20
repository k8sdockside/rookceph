import { describe, expect, it } from 'vitest';
import { capacityOf, checks, clusterView, fullnessTone, healthTone, healthWord, mixedVersions } from './health.js';
import type { CephCluster } from './rook.js';

function cluster(spec: CephCluster['spec'] = {}, status: CephCluster['status'] = {}): CephCluster {
    return { apiVersion: 'ceph.rook.io/v1', kind: 'CephCluster', metadata: { name: 'rook-ceph', namespace: 'rook-ceph' }, spec, status };
}

describe('healthWord and healthTone', () => {
    it('turns Ceph s three words into something a page can say', () => {
        expect(healthWord('HEALTH_OK')).toBe('ok');
        expect(healthWord('HEALTH_WARN')).toBe('warn');
        expect(healthWord('HEALTH_ERR')).toBe('err');
        expect(healthTone('HEALTH_OK')).toBe('ok');
        expect(healthTone('HEALTH_WARN')).toBe('warn');
        expect(healthTone('HEALTH_ERR')).toBe('error');
    });

    // The distinction the whole dashboard rests on: Rook writes no health at
    // all until it has talked to the mons once, and a fresh install drawn in
    // red is a support ticket.
    it('does not call "not asked yet" unhealthy', () => {
        expect(healthWord('')).toBe('unknown');
        expect(healthTone('')).toBe('');
    });
});

describe('checks', () => {
    it('puts errors before warnings, and is stable inside each', () => {
        const list = checks({
            POOL_NEAR_FULL: { severity: 'HEALTH_WARN', message: 'a pool is nearly full' },
            OSD_DOWN: { severity: 'HEALTH_ERR', message: '1 osds down' },
            MON_CLOCK_SKEW: { severity: 'HEALTH_WARN', message: 'clock skew detected' },
        });
        expect(list.map((check) => check.id)).toEqual(['OSD_DOWN', 'MON_CLOCK_SKEW', 'POOL_NEAR_FULL']);
        expect(list[0]?.tone).toBe('error');
    });

    it('is empty rather than broken when Rook has recorded nothing', () => {
        expect(checks(undefined)).toEqual([]);
        expect(checks(null)).toEqual([]);
    });
});

describe('capacityOf', () => {
    it('reads what ceph df reported', () => {
        const capacity = capacityOf(cluster({}, { ceph: { capacity: { bytesTotal: 1000, bytesUsed: 400, bytesAvailable: 600 } } }));
        expect(capacity).toMatchObject({ total: 1000, used: 400, available: 600, known: true });
    });

    // Rook writes zeroes before it has ever read the cluster, and "0 B of
    // 0 B" drawn as a full bar is an outage the cluster is not having.
    it('says nothing is known rather than that the cluster is empty', () => {
        expect(capacityOf(cluster()).known).toBe(false);
        expect(capacityOf(cluster({}, { ceph: { capacity: { bytesTotal: 0, bytesUsed: 0 } } })).known).toBe(false);
    });

    it('never lets used exceed the total, however it was reported', () => {
        const capacity = capacityOf(cluster({}, { ceph: { capacity: { bytesTotal: 100, bytesUsed: 150 } } }));
        expect(capacity.used).toBe(100);
    });
});

describe('fullnessTone', () => {
    it('follows Ceph own nearfull and full ratios', () => {
        const at = (share: number) => fullnessTone({ total: 100, used: share, available: 100 - share, known: true, lastUpdated: '' });
        expect(at(50)).toBe('ok');
        expect(at(85)).toBe('warn');
        expect(at(95)).toBe('error');
    });

    it('has no opinion about a cluster that has reported nothing', () => {
        expect(fullnessTone({ total: 0, used: 0, available: 0, known: false, lastUpdated: '' })).toBe('');
    });
});

describe('clusterView', () => {
    it('knows an external cluster from a converged one', () => {
        expect(clusterView(cluster({ external: { enable: true }, mon: { count: 3 } })).external).toBe(true);
        // An external cluster has no mons here, whatever the spec says, so
        // the page must not offer to count them.
        expect(clusterView(cluster({ external: { enable: true }, mon: { count: 3 } })).monsWanted).toBe(0);
        expect(clusterView(cluster({ mon: { count: 3 } })).external).toBe(false);
        expect(clusterView(cluster({ mon: { count: 3 } })).monsWanted).toBe(3);
    });

    it('falls back to state when Rook has written no phase', () => {
        expect(clusterView(cluster({}, { state: 'Created' })).phase).toBe('Created');
        expect(clusterView(cluster({}, { phase: 'Ready', state: 'Created' })).phase).toBe('Ready');
    });

    it('survives a cluster Rook has not touched yet', () => {
        const view = clusterView({ metadata: { name: 'fresh' } });
        expect(view.health).toBe('');
        expect(view.checks).toEqual([]);
        expect(view.capacity.known).toBe(false);
        expect(view.deviceClasses).toEqual([]);
    });
});

describe('mixedVersions', () => {
    it('is true only when the daemons really are on different versions', () => {
        const same = clusterView(cluster({}, { ceph: { versions: { mon: { '18.2.4': 3 }, osd: { '18.2.4': 6 } } } }));
        const mixed = clusterView(cluster({}, { ceph: { versions: { mon: { '18.2.4': 3 }, osd: { '18.2.4': 4, '17.2.7': 2 } } } }));
        expect(mixedVersions(same)).toBe(false);
        expect(mixedVersions(mixed)).toBe(true);
    });
});
