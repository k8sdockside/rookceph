// @vitest-environment happy-dom
//
// Does each page actually draw?
//
// The model tests say the Ceph knowledge is right; this says the pages that
// use it put it on the screen, against objects shaped the way Rook really
// writes them -- health details as a map, sizes as quantities, OSD ids as pod
// labels. It runs each page module against a stub of the bridge, with no
// cluster and no app, and reads the text that comes out.
//
// It is here rather than in a browser because the thing worth catching is a
// page that throws on a shape the cluster produces and this machine does not:
// a CephCluster Rook has not read yet, an external cluster with no daemons,
// a storage class whose pool was deleted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bucketClaims, cephCluster, claims, externalCluster, filesystems, nfses, objectStores, pods, pools, storageClasses, volumes } from '../fixtures.js';

type Lists = Record<string, unknown[]>;

let opened: unknown[] = [];

function bridge(lists: Lists, object: unknown = null, ctx: Partial<K8sDockside.Context> = {}) {
    return {
        ready: async () => ({
            pluginId: 'rookceph',
            viewId: '',
            sectionId: '',
            object: null,
            contextId: 'test',
            contextName: 'test-cluster',
            readable: [],
            write: true,
            actions: [],
            theme: { id: 'k8sdockside-dark', base: 'dark' as const, tokens: {} },
            ...ctx,
        }),
        object: async () => object,
        list: async ({ kind }: { kind: string }) => {
            if (!(kind in lists)) throw new Error(`the cluster does not serve ${kind}`);
            return lists[kind];
        },
        get: async () => object,
        open: async (ref: unknown) => void opened.push(ref),
        openView: async () => null,
        openUrl: async () => null,
        summary: async () => ({ pluginId: 'rookceph', installed: true, checked: true, requirements: [], cards: [], error: '' }),
        storage: { get: async () => null, set: async () => null, remove: async () => null, keys: async () => [] },
        actions: async () => [],
        run: async () => ({ created: '' }),
        resize: async () => null,
        watch: () => () => {},
        namespaces: async () => [],
        charts: async () => ({ attached: false, source: {}, charts: [], range: 60 }),
        patch: async () => null,
        create: async () => ({ name: '' }),
        edit: async () => null,
        logs: async () => null,
        on: () => () => {},
    };
}

const FULL: Lists = {
    'crd:cephclusters.ceph.rook.io': [cephCluster],
    'crd:cephblockpools.ceph.rook.io': pools,
    'crd:cephfilesystems.ceph.rook.io': filesystems,
    'crd:cephobjectstores.ceph.rook.io': objectStores,
    'crd:cephnfses.ceph.rook.io': nfses,
    'crd:objectbucketclaims.objectbucket.io': bucketClaims,
    storageclasses: storageClasses,
    persistentvolumeclaims: claims,
    persistentvolumes: volumes,
    pods: pods,
};

function page(html: string) {
    document.body.innerHTML = html;
}

/** Runs a page module fresh, then lets its promises settle. */
async function run(module: string): Promise<string> {
    vi.resetModules();
    await import(module);
    for (let i = 0; i < 25; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return document.body.textContent ?? '';
}

beforeEach(() => {
    opened = [];
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('the dashboard', () => {
    it('draws the health word, every Ceph check, and the capacity', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        page('<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./overview.js');

        expect(text).toContain('HEALTH_WARN');
        expect(text).toContain('OSD_NEARFULL');
        expect(text).toContain('1 nearfull osd(s)');
        expect(text).toContain('POOL_APP_NOT_ENABLED');
        // 5.3 TiB of 6 TiB is 88%: past nearfull, not past full.
        expect(text).toMatch(/8[0-9]% full/);
        expect(text).toContain('Needs attention');
        // The single-copy pool, which Ceph itself says nothing about.
        expect(text).toContain('Pool scratch has no redundancy');
        // The mon that is not up, by name.
        expect(text).toContain('rook-ceph-mon-c-1');
        // Mixed versions, because osd has two.
        expect(text).toContain('More than one Ceph version is running');
    });

    it('says a cluster is a Ceph client when it has classes but no CephCluster', async () => {
        vi.stubGlobal('k8sdockside', bridge({ storageclasses: storageClasses, persistentvolumeclaims: claims, pods: [] }));
        page('<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./overview.js');

        expect(text).toContain('This cluster is a Ceph client');
        expect(text).toContain('rook-ceph.rbd.csi.ceph.com');
        expect(text).not.toContain('HEALTH_');
    });

    it('says plainly that there is no Ceph when there is none', async () => {
        vi.stubGlobal('k8sdockside', bridge({ storageclasses: [{ metadata: { name: 'longhorn' }, provisioner: 'driver.longhorn.io' }], pods: [] }));
        page('<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./overview.js');

        expect(text).toContain('No Ceph in this cluster');
    });
});

describe('the storage class map', () => {
    it('groups every Ceph class by what it hands a workload, and leaves Longhorn out', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        page('<div id="page"><div id="head"></div><div id="bar"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./storage.js');

        expect(text).toContain('Block (RBD)');
        expect(text).toContain('Shared file (CephFS)');
        expect(text).toContain('NFS');
        expect(text).toContain('Object (S3 bucket)');
        expect(text).toContain('rook-ceph-block');
        expect(text).toContain('rook-cephfs');
        expect(text).toContain('rook-ceph-bucket');
        expect(text).not.toContain('driver.longhorn.io');
        // The class whose pool does not exist.
        expect(text).toContain('No CephBlockPool named gone');
        // The claims, added up as sizes rather than as numbers.
        expect(text).toContain('100 Gi');
        expect(text).toContain('5.00 Ti');
        // The default marker, and the pool's redundancy.
        expect(text).toContain('default');
        expect(text).toContain('3 copies');
    });
});

describe('pools & filesystems', () => {
    it('shows how each pool keeps its data and shouts about the one that does not', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        page('<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./pools.js');

        expect(text).toContain('replicapool');
        expect(text).toContain('3 copies');
        expect(text).toContain('EC 4+2');
        expect(text).toContain('one failed OSD loses everything in this pool');
        expect(text).toContain('myfs');
        expect(text).toContain('1 active MDS');
        expect(text).toContain('my-store');
        expect(text).toContain('rook-ceph-rgw-my-store.rook-ceph.svc');
        expect(text).toContain('my-nfs');
    });
});

describe('daemons & OSDs', () => {
    it('lays out the daemons, sorts OSDs by number, and warns about the quorum', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        page('<div id="page"><div id="head"></div><div id="bar"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./daemons.js');

        expect(text).toContain('Monitors');
        expect(text).toContain('2 of 3 running');
        expect(text).toContain('OSDs');
        expect(text).toContain('active');
        expect(text).toContain('ssd');
        expect(text).toContain('hdd');
        // The prepare job must not be counted as an OSD: 4 osd pods, not 5.
        expect(text).toContain('3 of 4 running');
        // osd.10 after osd.2, not between osd.1 and osd.2.
        expect(text.indexOf('osd.10')).toBeGreaterThan(text.indexOf('osd.2'));
    });
});

describe('the panels', () => {
    it('tells a claim which RBD image it really is', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, claims[0]));
        page('<div id="panel"></div>');
        const text = await run('./pvc.js');

        expect(text).toContain('Block (RBD)');
        expect(text).toContain('csi-vol-abc');
        expect(text).toContain('replicapool');
        expect(text).toContain('3 copies');
        expect(text).toContain('100 Gi');
    });

    it('says what a storage class s parameters add up to', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, storageClasses[1]));
        page('<div id="panel"></div>');
        const text = await run('./sc.js');

        expect(text).toContain('mountable by many pods at once');
        expect(text).toContain('myfs');
        expect(text).toContain('the Ceph image or subvolume is deleted with it');
    });

    it('says what draining a node costs', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, { metadata: { name: 'node-1' } }));
        page('<div id="panel"></div>');
        const text = await run('./node.js');

        expect(text).toContain('1 monitor');
        expect(text).toContain('2 OSDs');
        expect(text).toContain('a quorum is more than half of them');
    });

    it('draws a CephCluster s health and capacity', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL, cephCluster));
        page('<div id="panel"></div>');
        const text = await run('./cluster.js');

        expect(text).toContain('HEALTH_WARN');
        expect(text).toContain('OSD_NEARFULL');
        expect(text).toContain('bluestore');
    });

    it('draws an external cluster without pretending its daemons are here', async () => {
        vi.stubGlobal('k8sdockside', bridge({ ...FULL, 'crd:cephclusters.ceph.rook.io': [externalCluster] }, externalCluster));
        page('<div id="panel"></div>');
        const text = await run('./cluster.js');

        expect(text).toContain('external Ceph');
        expect(text).toContain('HEALTH_OK');
    });
});

describe('the clusters view', () => {
    it('draws the cluster, its versions and its checks', async () => {
        vi.stubGlobal('k8sdockside', bridge(FULL));
        page('<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./clusters.js');

        expect(text).toContain('rook-ceph');
        expect(text).toContain('converged');
        expect(text).toContain('18.2.4');
        expect(text).toContain('Health checks');
        expect(text).toContain('OSD_NEARFULL');
        expect(text).toContain('3 machines');
    });

    it('draws an external cluster as external, with no daemon counts', async () => {
        vi.stubGlobal('k8sdockside', bridge({ ...FULL, 'crd:cephclusters.ceph.rook.io': [externalCluster] }));
        page('<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>');
        const text = await run('./clusters.js');

        expect(text).toContain('external');
        expect(text).toContain('This is an external cluster');
        expect(text).toContain('none of them run here');
    });
});
