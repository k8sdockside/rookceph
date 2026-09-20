// A cluster's worth of Rook objects, shaped the way Rook really writes them.
//
// Used by the page render test and by scripts/preview.mjs, so that what the
// test asserts on and what the preview draws are the same cluster and cannot
// drift apart.
//
// It is deliberately not a *healthy* cluster. A fixture where everything is
// fine exercises none of the paths that matter: this one is HEALTH_WARN with
// two checks, 88% full, one monitor down, one OSD crash-looping, a pool
// keeping a single copy, daemons on two Ceph versions, a storage class whose
// pool was deleted, and a second cluster that is external. Drawing all of
// that correctly is the whole job.
//
// It lives in src/ rather than src/pages/ because scripts/build.mjs turns
// every non-test .ts under src/pages into a page of its own.

export const cephCluster = {
    apiVersion: 'ceph.rook.io/v1',
    kind: 'CephCluster',
    metadata: { name: 'rook-ceph', namespace: 'rook-ceph' },
    spec: { mon: { count: 3 }, dashboard: { enabled: true }, storage: { useAllDevices: true }, cephVersion: { image: 'quay.io/ceph/ceph:v18.2.4' } },
    status: {
        phase: 'Ready',
        state: 'Created',
        version: { image: 'quay.io/ceph/ceph:v18.2.4', version: '18.2.4-0' },
        storage: { deviceClasses: [{ name: 'ssd' }, { name: 'hdd' }], osd: { storeType: { bluestore: 6 } } },
        ceph: {
            health: 'HEALTH_WARN',
            fsid: '3fd0a1f2-2b7a-4c3a-9b0e-000000000000',
            capacity: { bytesTotal: 6 * 1024 ** 4, bytesUsed: 5.3 * 1024 ** 4, bytesAvailable: 0.7 * 1024 ** 4, lastUpdated: '2026-09-20T08:00:00Z' },
            versions: { mon: { '18.2.4': 3 }, osd: { '18.2.4': 5, '17.2.7': 1 } },
            details: {
                OSD_NEARFULL: { severity: 'HEALTH_WARN', message: '1 nearfull osd(s)' },
                POOL_APP_NOT_ENABLED: { severity: 'HEALTH_WARN', message: 'application not enabled on 1 pool(s)' },
            },
        },
    },
};

export const externalCluster = {
    metadata: { name: 'remote-ceph', namespace: 'rook-ceph-external' },
    spec: { external: { enable: true } },
    status: { phase: 'Connected', ceph: { health: 'HEALTH_OK', capacity: { bytesTotal: 100 * 1024 ** 4, bytesUsed: 20 * 1024 ** 4 } } },
};

export const pools = [
    { metadata: { name: 'replicapool', namespace: 'rook-ceph' }, spec: { failureDomain: 'host', replicated: { size: 3 } }, status: { phase: 'Ready', poolID: 3 } },
    { metadata: { name: 'ec-pool', namespace: 'rook-ceph' }, spec: { failureDomain: 'host', erasureCoded: { dataChunks: 4, codingChunks: 2 } }, status: { phase: 'Ready', poolID: 5 } },
    { metadata: { name: 'scratch', namespace: 'rook-ceph' }, spec: { replicated: { size: 1 } }, status: { phase: 'Ready', poolID: 7 } },
];

export const filesystems = [
    {
        metadata: { name: 'myfs', namespace: 'rook-ceph' },
        spec: { metadataPool: { replicated: { size: 3 } }, dataPools: [{ name: 'replicated', replicated: { size: 3 } }], metadataServer: { activeCount: 1, activeStandby: true } },
        status: { phase: 'Ready' },
    },
];

export const objectStores = [
    {
        metadata: { name: 'my-store', namespace: 'rook-ceph' },
        spec: { gateway: { instances: 2, port: 80 }, metadataPool: { replicated: { size: 3 } }, dataPool: { erasureCoded: { dataChunks: 2, codingChunks: 1 } } },
        status: { phase: 'Ready', replicas: 2, endpoints: { insecure: ['http://rook-ceph-rgw-my-store.rook-ceph.svc:80'], secure: [] } },
    },
];

export const nfses = [{ metadata: { name: 'my-nfs', namespace: 'rook-ceph' }, spec: { server: { active: 1 }, rados: { pool: '.nfs' } }, status: { phase: 'Ready' } }];

export const storageClasses = [
    {
        metadata: { name: 'rook-ceph-block', annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' } },
        provisioner: 'rook-ceph.rbd.csi.ceph.com',
        parameters: { clusterID: 'rook-ceph', pool: 'replicapool', imageFormat: '2', imageFeatures: 'layering', 'csi.storage.k8s.io/fstype': 'ext4', 'csi.storage.k8s.io/provisioner-secret-name': 'rook-csi-rbd-provisioner' },
        reclaimPolicy: 'Delete',
        volumeBindingMode: 'Immediate',
        allowVolumeExpansion: true,
    },
    {
        metadata: { name: 'rook-cephfs' },
        provisioner: 'rook-ceph.cephfs.csi.ceph.com',
        parameters: { clusterID: 'rook-ceph', fsName: 'myfs', pool: 'myfs-replicated' },
        reclaimPolicy: 'Delete',
        volumeBindingMode: 'Immediate',
        allowVolumeExpansion: true,
    },
    { metadata: { name: 'rook-nfs' }, provisioner: 'rook-ceph.nfs.csi.ceph.com', parameters: { clusterID: 'rook-ceph', nfsCluster: 'my-nfs', server: 'rook-ceph-nfs-my-nfs-a', fsName: 'myfs', pool: 'myfs-replicated' }, reclaimPolicy: 'Delete' },
    { metadata: { name: 'rook-ceph-bucket' }, provisioner: 'rook-ceph.ceph.rook.io/bucket', parameters: { objectStoreName: 'my-store', objectStoreNamespace: 'rook-ceph', region: 'us-east-1' }, reclaimPolicy: 'Delete' },
    { metadata: { name: 'broken-block' }, provisioner: 'rook-ceph.rbd.csi.ceph.com', parameters: { clusterID: 'rook-ceph', pool: 'gone' }, reclaimPolicy: 'Delete' },
    { metadata: { name: 'longhorn' }, provisioner: 'driver.longhorn.io', parameters: {} },
];

export const claims = [
    { metadata: { name: 'data-db-0', namespace: 'apps' }, spec: { storageClassName: 'rook-ceph-block', volumeName: 'pvc-1' }, status: { phase: 'Bound', capacity: { storage: '100Gi' } } },
    { metadata: { name: 'shared', namespace: 'apps' }, spec: { storageClassName: 'rook-cephfs', resources: { requests: { storage: '5Ti' } } }, status: { phase: 'Pending' } },
];

export const volumes = [
    {
        metadata: { name: 'pvc-1' },
        spec: { storageClassName: 'rook-ceph-block', csi: { driver: 'rook-ceph.rbd.csi.ceph.com', volumeHandle: '0001-0009-rook-ceph-0000000000000003-abc', fsType: 'ext4', volumeAttributes: { imageName: 'csi-vol-abc', pool: 'replicapool' } } },
        status: { phase: 'Bound' },
    },
];

function pod(name: string, labels: Record<string, string>, node: string, ok = true) {
    return {
        metadata: { name, namespace: 'rook-ceph', labels: { ...labels, rook_cluster: 'rook-ceph' } },
        spec: { nodeName: node },
        status: ok
            ? { phase: 'Running', startTime: '2026-09-19T08:00:00Z', containerStatuses: [{ name: 'c', ready: true, restartCount: 0 }] }
            : { phase: 'Pending', startTime: '2026-09-20T08:00:00Z', containerStatuses: [{ name: 'c', ready: false, restartCount: 7, state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m restarting failed container' } } }] },
    };
}

export const pods = [
    pod('rook-ceph-mon-a-1', { app: 'rook-ceph-mon', ceph_daemon_id: 'a' }, 'node-1'),
    pod('rook-ceph-mon-b-1', { app: 'rook-ceph-mon', ceph_daemon_id: 'b' }, 'node-2'),
    pod('rook-ceph-mon-c-1', { app: 'rook-ceph-mon', ceph_daemon_id: 'c' }, 'node-3', false),
    pod('rook-ceph-mgr-a-1', { app: 'rook-ceph-mgr', ceph_daemon_id: 'a', mgr_role: 'active' }, 'node-1'),
    pod('rook-ceph-mgr-b-1', { app: 'rook-ceph-mgr', ceph_daemon_id: 'b', mgr_role: 'standby' }, 'node-2'),
    pod('rook-ceph-osd-0-1', { app: 'rook-ceph-osd', 'ceph-osd-id': '0', 'device-class': 'ssd', 'failure-domain': 'node-1' }, 'node-1'),
    pod('rook-ceph-osd-1-1', { app: 'rook-ceph-osd', 'ceph-osd-id': '1', 'device-class': 'ssd', 'failure-domain': 'node-2' }, 'node-2'),
    pod('rook-ceph-osd-10-1', { app: 'rook-ceph-osd', 'ceph-osd-id': '10', 'device-class': 'hdd', 'failure-domain': 'node-3' }, 'node-3'),
    pod('rook-ceph-osd-2-1', { app: 'rook-ceph-osd', 'ceph-osd-id': '2', 'device-class': 'hdd', 'failure-domain': 'node-1' }, 'node-1', false),
    pod('rook-ceph-mds-myfs-a-1', { app: 'rook-ceph-mds', ceph_daemon_id: 'myfs-a' }, 'node-1'),
    pod('rook-ceph-rgw-my-store-a-1', { app: 'rook-ceph-rgw', ceph_daemon_id: 'my-store-a' }, 'node-2'),
    pod('rook-ceph-operator-1', { app: 'rook-ceph-operator' }, 'node-1'),
    pod('rook-ceph-osd-prepare-node-1-x', { app: 'rook-ceph-osd-prepare' }, 'node-1'),
];

export const bucketClaims = [{ metadata: { name: 'photos', namespace: 'apps' }, spec: { storageClassName: 'rook-ceph-bucket', generateBucketName: 'photos' }, status: { phase: 'Bound' } }];
