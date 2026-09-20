import { describe, expect, it } from 'vitest';
import { classView, classViews, consumesCeph, driverNamespace, isDefault, kindOf, poolName } from './classes.js';
import type { CephBlockPool, CephCluster, CephFilesystem, CephNFS, CephObjectStore, PersistentVolumeClaim, StorageClass } from './rook.js';

function sc(name: string, provisioner: string, parameters: Record<string, string> = {}, extra: Partial<StorageClass> = {}): StorageClass {
    return { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name }, provisioner, parameters, ...extra };
}

describe('kindOf', () => {
    // Rook names its drivers after the operator's namespace, so the whole
    // name is never the same twice. Matching on the suffix is what makes the
    // plugin work on a cluster whose operator is not in `rook-ceph`.
    it('recognises a Rook driver whatever namespace it was installed in', () => {
        expect(kindOf('rook-ceph.rbd.csi.ceph.com')).toBe('block');
        expect(kindOf('storage.rbd.csi.ceph.com')).toBe('block');
        expect(kindOf('rook-ceph.cephfs.csi.ceph.com')).toBe('file');
        expect(kindOf('rook-ceph.nfs.csi.ceph.com')).toBe('nfs');
        expect(kindOf('rook-ceph.ceph.rook.io/bucket')).toBe('bucket');
    });

    it('recognises a plain ceph-csi with no namespace prefix', () => {
        expect(kindOf('rbd.csi.ceph.com')).toBe('block');
        expect(kindOf('cephfs.csi.ceph.com')).toBe('file');
        expect(kindOf('nfs.csi.ceph.com')).toBe('nfs');
    });

    it('is not fooled by a name that merely contains one', () => {
        expect(kindOf('driver.longhorn.io')).toBe(null);
        expect(kindOf('ebs.csi.aws.com')).toBe(null);
        expect(kindOf('notrbd.csi.ceph.com.example')).toBe(null);
    });
});

describe('driverNamespace', () => {
    it('gets the operator namespace out of a Rook driver name', () => {
        expect(driverNamespace('rook-ceph.rbd.csi.ceph.com')).toBe('rook-ceph');
        expect(driverNamespace('ceph-storage.cephfs.csi.ceph.com')).toBe('ceph-storage');
    });

    it('is empty for a driver with no prefix', () => {
        expect(driverNamespace('rbd.csi.ceph.com')).toBe('');
    });
});

describe('isDefault', () => {
    it('reads both spellings of the annotation', () => {
        expect(isDefault(sc('a', 'rbd.csi.ceph.com', {}, { metadata: { name: 'a', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } } }))).toBe(true);
        expect(isDefault(sc('a', 'rbd.csi.ceph.com', {}, { metadata: { name: 'a', annotations: { 'storageclass.beta.kubernetes.io/is-default-class': 'true' } } }))).toBe(true);
        expect(isDefault(sc('a', 'rbd.csi.ceph.com', {}, { metadata: { name: 'a', annotations: { 'storageclass.kubernetes.io/is-default-class': 'false' } } }))).toBe(false);
        expect(isDefault(sc('a', 'rbd.csi.ceph.com'))).toBe(false);
    });
});

describe('classViews', () => {
    it('leaves storage classes that have nothing to do with Ceph alone', () => {
        const views = classViews([sc('longhorn', 'driver.longhorn.io'), sc('rook-ceph-block', 'rook-ceph.rbd.csi.ceph.com')]);
        expect(views.map((view) => view.name)).toEqual(['rook-ceph-block']);
    });

    it('groups block before file before bucket, so the page reads the same every time', () => {
        const views = classViews([
            sc('bucket', 'rook-ceph.ceph.rook.io/bucket'),
            sc('fs', 'rook-ceph.cephfs.csi.ceph.com'),
            sc('block', 'rook-ceph.rbd.csi.ceph.com'),
        ]);
        expect(views.map((view) => view.kind)).toEqual(['block', 'file', 'bucket']);
    });
});

const cluster: CephCluster = { metadata: { name: 'rook-ceph', namespace: 'rook-ceph' }, spec: {}, status: {} };
const pool: CephBlockPool = { metadata: { name: 'replicapool', namespace: 'rook-ceph' }, spec: { replicated: { size: 3 } }, status: { phase: 'Ready' } };
const filesystem: CephFilesystem = { metadata: { name: 'myfs', namespace: 'rook-ceph' }, spec: { metadataServer: { activeCount: 1 } }, status: { phase: 'Ready' } };
const store: CephObjectStore = { metadata: { name: 'my-store', namespace: 'rook-ceph' }, spec: {}, status: { phase: 'Ready' } };
const nfs: CephNFS = { metadata: { name: 'my-nfs', namespace: 'rook-ceph' }, spec: { server: { active: 1 } }, status: { phase: 'Ready' } };

describe('classView, with Rook in the cluster', () => {
    const backends = { clusters: [cluster], pools: [pool], filesystems: [filesystem], objectStores: [store], nfses: [nfs], claims: [] };

    // clusterID is a *namespace*, which is the thing that trips everyone up:
    // ceph-csi is told where the CephCluster lives, not what it is called.
    it('finds the CephCluster by the namespace in clusterID', () => {
        const view = classView(sc('block', 'rook-ceph.rbd.csi.ceph.com', { clusterID: 'rook-ceph', pool: 'replicapool' }), backends);
        expect(view?.cluster?.metadata.name).toBe('rook-ceph');
        expect(view?.pool?.metadata.name).toBe('replicapool');
        expect(view?.problem).toBe('');
    });

    it('follows a CephFS class to its filesystem, not to its data pool', () => {
        const view = classView(sc('fs', 'rook-ceph.cephfs.csi.ceph.com', { clusterID: 'rook-ceph', fsName: 'myfs', pool: 'myfs-replicated' }), backends);
        expect(view?.filesystem?.metadata.name).toBe('myfs');
        expect(view?.problem).toBe('');
    });

    it('follows an NFS class to both the CephNFS and the filesystem behind it', () => {
        const view = classView(sc('nfs', 'rook-ceph.nfs.csi.ceph.com', { clusterID: 'rook-ceph', nfsCluster: 'my-nfs', fsName: 'myfs', server: 'rook-ceph-nfs-my-nfs-a' }), backends);
        expect(view?.nfs?.metadata.name).toBe('my-nfs');
        expect(view?.filesystem?.metadata.name).toBe('myfs');
    });

    it('follows a bucket class to its object store', () => {
        const view = classView(sc('bucket', 'rook-ceph.ceph.rook.io/bucket', { objectStoreName: 'my-store', objectStoreNamespace: 'rook-ceph' }), backends);
        expect(view?.objectStore?.metadata.name).toBe('my-store');
    });

    it('says so when the class names a pool that is not there', () => {
        const view = classView(sc('block', 'rook-ceph.rbd.csi.ceph.com', { clusterID: 'rook-ceph', pool: 'gone' }), backends);
        expect(view?.problem).toContain('No CephBlockPool named gone');
    });

    it('says so when the class names a namespace with no CephCluster in it', () => {
        const view = classView(sc('block', 'rook-ceph.rbd.csi.ceph.com', { clusterID: 'elsewhere', pool: 'replicapool' }), backends);
        expect(view?.problem).toContain('No CephCluster in namespace elsewhere');
    });
});

describe('classView, on a client-only cluster', () => {
    // The case the whole model is shaped around: ceph-csi and a handful of
    // storage classes, no Rook at all. Calling every class broken here would
    // be wrong on every cluster of this shape, which is most of them.
    it('does not call a class broken just because the Ceph is elsewhere', () => {
        const view = classView(sc('ceph-block', 'rbd.csi.ceph.com', { clusterID: 'b1f2c3', pool: 'kube' }));
        expect(view?.kind).toBe('block');
        expect(view?.cluster).toBe(null);
        expect(view?.problem).toBe('');
        expect(view?.tone).toBe('ok');
    });
});

describe('claims', () => {
    const claims: PersistentVolumeClaim[] = [
        { metadata: { name: 'a', namespace: 'app' }, spec: { storageClassName: 'block' }, status: { phase: 'Bound', capacity: { storage: '10Gi' } } },
        { metadata: { name: 'b', namespace: 'app' }, spec: { storageClassName: 'block', resources: { requests: { storage: '5Gi' } } }, status: { phase: 'Pending' } },
        { metadata: { name: 'c', namespace: 'app' }, spec: { storageClassName: 'other' }, status: { phase: 'Bound', capacity: { storage: '1Ti' } } },
    ];

    it('counts only its own claims, and adds up their real sizes', () => {
        const view = classView(sc('block', 'rook-ceph.rbd.csi.ceph.com'), { clusters: [], pools: [], filesystems: [], objectStores: [], nfses: [], claims });
        expect(view?.claims).toBe(2);
        expect(view?.pending).toBe(1);
        expect(view?.requested).toBe(15 * 1024 ** 3);
    });
});

describe('poolName', () => {
    it('prefers the pool name the spec overrides with', () => {
        expect(poolName({ metadata: { name: 'resource' }, spec: { name: 'actual' } })).toBe('actual');
        expect(poolName({ metadata: { name: 'resource' }, spec: {} })).toBe('resource');
    });
});

describe('consumesCeph', () => {
    it('is how the overview tells a client cluster from one with no Ceph at all', () => {
        expect(consumesCeph([sc('longhorn', 'driver.longhorn.io')])).toBe(false);
        expect(consumesCeph([sc('longhorn', 'driver.longhorn.io'), sc('ceph', 'rbd.csi.ceph.com')])).toBe(true);
        expect(consumesCeph([])).toBe(false);
    });
});
