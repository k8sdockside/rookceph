import { describe, expect, it } from 'vitest';
import { issues, type Sources } from './attention.js';
import { classViews } from './classes.js';
import { clusterView } from './health.js';
import { daemonView } from './daemons.js';
import type { CephBlockPool, CephCluster, Pod, StorageClass } from './rook.js';

const empty: Sources = { clusters: [], daemons: [], pools: [], filesystems: [], objectStores: [], classes: [] };

function cluster(status: CephCluster['status'], spec: CephCluster['spec'] = {}): CephCluster {
    return { metadata: { name: 'rook-ceph', namespace: 'rook-ceph' }, spec, status };
}

describe('issues', () => {
    it('finds nothing wrong with a healthy cluster', () => {
        const healthy = clusterView(cluster({ phase: 'Ready', ceph: { health: 'HEALTH_OK', capacity: { bytesTotal: 100, bytesUsed: 10 } } }));
        expect(issues({ ...empty, clusters: [healthy] })).toEqual([]);
    });

    it('writes out every Ceph health check, in Ceph s own words', () => {
        const view = clusterView(
            cluster({
                phase: 'Ready',
                ceph: {
                    health: 'HEALTH_WARN',
                    capacity: { bytesTotal: 100, bytesUsed: 10 },
                    details: { POOL_APP_NOT_ENABLED: { severity: 'HEALTH_WARN', message: 'application not enabled on 1 pool(s)' } },
                },
            }),
        );
        const found = issues({ ...empty, clusters: [view] });
        expect(found).toHaveLength(1);
        expect(found[0]?.title).toBe('rook-ceph: POOL_APP_NOT_ENABLED');
        expect(found[0]?.detail).toBe('application not enabled on 1 pool(s)');
    });

    it('puts an error check above a full-ish cluster above a pending claim', () => {
        const view = clusterView(
            cluster({
                phase: 'Ready',
                ceph: { health: 'HEALTH_ERR', capacity: { bytesTotal: 100, bytesUsed: 90 }, details: { OSD_FULL: { severity: 'HEALTH_ERR', message: '1 full osd(s)' } } },
            }),
        );
        const found = issues({ ...empty, clusters: [view] });
        expect(found.map((issue) => issue.tone)).toEqual(['error', 'warn']);
        expect(found[0]?.title).toContain('OSD_FULL');
    });

    // A pool with one copy is the failure that Ceph never warns about: it is
    // HEALTH_OK right up until a disk dies.
    it('calls out a pool with no redundancy, which Ceph itself will not', () => {
        const pool: CephBlockPool = { metadata: { name: 'risky', namespace: 'rook-ceph' }, spec: { replicated: { size: 1 } }, status: { phase: 'Ready' } };
        const found = issues({ ...empty, pools: [pool] });
        expect(found).toHaveLength(1);
        expect(found[0]?.title).toBe('Pool risky has no redundancy');
        expect(found[0]?.detail).toContain('1 copy');
    });

    it('treats an erasure-coded pool with no coding chunks the same way', () => {
        const pool: CephBlockPool = { metadata: { name: 'ec', namespace: 'rook-ceph' }, spec: { erasureCoded: { dataChunks: 4, codingChunks: 0 } }, status: { phase: 'Ready' } };
        expect(issues({ ...empty, pools: [pool] })[0]?.detail).toContain('EC 4+0');
    });

    it('leaves a properly replicated pool alone', () => {
        const pool: CephBlockPool = { metadata: { name: 'fine', namespace: 'rook-ceph' }, spec: { replicated: { size: 3 } }, status: { phase: 'Ready' } };
        expect(issues({ ...empty, pools: [pool] })).toEqual([]);
    });

    it('shouts about a cluster that has been marked for destruction', () => {
        const view = clusterView(cluster({ phase: 'Ready', ceph: { health: 'HEALTH_OK' } }, { cleanupPolicy: { confirmation: 'yes-really-destroy-data' } }));
        const found = issues({ ...empty, clusters: [view] });
        expect(found[0]?.tone).toBe('error');
        expect(found[0]?.title).toContain('being destroyed');
    });

    it('reports a daemon that is not running, with the pod to open', () => {
        const down: Pod = {
            metadata: { name: 'rook-ceph-osd-2-x', namespace: 'rook-ceph', labels: { app: 'rook-ceph-osd', 'ceph-osd-id': '2' } },
            spec: { nodeName: 'node-3' },
            status: { phase: 'Failed', containerStatuses: [{ name: 'osd', ready: false, restartCount: 5, state: { terminated: { reason: 'Error', exitCode: 1 } } }] },
        };
        const found = issues({ ...empty, daemons: [daemonView(down)] });
        expect(found[0]?.ref).toEqual({ kind: 'pods', namespace: 'rook-ceph', name: 'rook-ceph-osd-2-x' });
        expect(found[0]?.detail).toContain('Error');
    });

    it('reports a storage class whose pool is gone', () => {
        const storageClass: StorageClass = {
            metadata: { name: 'rook-ceph-block' },
            provisioner: 'rook-ceph.rbd.csi.ceph.com',
            parameters: { clusterID: 'rook-ceph', pool: 'missing' },
        };
        const classes = classViews([storageClass], { clusters: [cluster({})], pools: [], filesystems: [], objectStores: [], nfses: [], claims: [] });
        const found = issues({ ...empty, classes });
        expect(found[0]?.title).toContain('rook-ceph-block points at nothing');
    });

    it('says nothing about a healthy cluster that simply has not been read yet, except that', () => {
        const fresh = clusterView(cluster({}));
        const found = issues({ ...empty, clusters: [fresh] });
        expect(found).toHaveLength(1);
        expect(found[0]?.tone).toBe('warn');
        expect(found[0]?.title).toContain('has not reported its status');
    });

    // An external cluster has no mons here to have failed to report.
    it('does not nag about an external cluster that has not reported', () => {
        const external = clusterView(cluster({ phase: 'Connected' }, { external: { enable: true } }));
        expect(issues({ ...empty, clusters: [external] })).toEqual([]);
    });
});
