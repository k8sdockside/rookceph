// The slices of Rook's custom resources these pages actually read.
//
// The bridge hands back whole objects typed only as K8sDockside.KubeObject,
// whose `spec` and `status` are `unknown`. Narrowing them here, once, is what
// makes the rest of src/ type-safe: a page says `list<CephCluster>(...)` and
// gets fields rather than casts.
//
// Only the fields the pages read are declared, and every one of them is
// optional: a resource Rook has not reconciled yet has no status at all, and
// a field added in a later Rook is simply absent in an older one. Rook serves
// ceph.rook.io/v1; the field names here are the JSON tags in
// rook/pkg/apis/ceph.rook.io/v1/types.go.

/** The kinds this plugin reads, spelled as the app spells them. */
export const CLUSTERS = 'crd:cephclusters.ceph.rook.io';
export const BLOCK_POOLS = 'crd:cephblockpools.ceph.rook.io';
export const FILESYSTEMS = 'crd:cephfilesystems.ceph.rook.io';
export const OBJECT_STORES = 'crd:cephobjectstores.ceph.rook.io';
export const OBJECT_STORE_USERS = 'crd:cephobjectstoreusers.ceph.rook.io';
export const NFSES = 'crd:cephnfses.ceph.rook.io';
export const CLIENTS = 'crd:cephclients.ceph.rook.io';
export const RBD_MIRRORS = 'crd:cephrbdmirrors.ceph.rook.io';
export const FS_MIRRORS = 'crd:cephfilesystemmirrors.ceph.rook.io';
export const SUBVOLUME_GROUPS = 'crd:cephfilesystemsubvolumegroups.ceph.rook.io';
export const RADOS_NAMESPACES = 'crd:cephblockpoolradosnamespaces.ceph.rook.io';
export const BUCKET_CLAIMS = 'crd:objectbucketclaims.objectbucket.io';
export const BUCKETS = 'crd:objectbuckets.objectbucket.io';

/** Core kinds the pages read beside Rook's own. */
export const PODS = 'pods';
export const NODES = 'nodes';
export const STORAGE_CLASSES = 'storageclasses';
export const PVCS = 'persistentvolumeclaims';
export const PVS = 'persistentvolumes';

/** The label Rook puts the daemon's app name under, and the cluster's namespace. */
export const APP_LABEL = 'app';
export const CLUSTER_LABEL = 'rook_cluster';

/** The `app` label value of each Ceph daemon Rook runs. */
export const APP = {
    mon: 'rook-ceph-mon',
    mgr: 'rook-ceph-mgr',
    osd: 'rook-ceph-osd',
    osdPrepare: 'rook-ceph-osd-prepare',
    mds: 'rook-ceph-mds',
    rgw: 'rook-ceph-rgw',
    nfs: 'rook-ceph-nfs',
    rbdMirror: 'rook-ceph-rbd-mirror',
    operator: 'rook-ceph-operator',
    crash: 'rook-ceph-crashcollector',
    exporter: 'rook-ceph-exporter',
} as const;

/** Labels Rook puts on the OSD and mgr pods, which no other daemon carries. */
export const OSD_ID_LABEL = 'ceph-osd-id';
export const DEVICE_CLASS_LABEL = 'device-class';
export const FAILURE_DOMAIN_LABEL = 'failure-domain';
export const PORTABLE_LABEL = 'portable';
export const DAEMON_ID_LABEL = 'ceph_daemon_id';
export const MGR_ROLE_LABEL = 'mgr_role';

export interface Condition {
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
    lastHeartbeatTime?: string;
    lastTransitionTime?: string;
}

/** One line of `ceph status`: a check id, how bad it is, and what it says. */
export interface CephHealthMessage {
    severity?: string;
    message?: string;
}

/** What Rook last read out of `ceph df`. Byte counts, as numbers. */
export interface CephCapacity {
    bytesTotal?: number;
    bytesUsed?: number;
    bytesAvailable?: number;
    lastUpdated?: string;
}

export interface CephStatus {
    /** HEALTH_OK, HEALTH_WARN or HEALTH_ERR. */
    health?: string;
    /** Check id -> what it says: MON_DOWN, POOL_NEAR_FULL, and the rest. */
    details?: Record<string, CephHealthMessage> | null;
    lastChecked?: string;
    lastChanged?: string;
    previousHealth?: string;
    capacity?: CephCapacity;
    /** Daemon type -> ceph version string -> how many daemons run it. */
    versions?: {
        mon?: Record<string, number>;
        mgr?: Record<string, number>;
        osd?: Record<string, number>;
        rgw?: Record<string, number>;
        mds?: Record<string, number>;
        overall?: Record<string, number>;
    } | null;
    fsid?: string;
}

export interface CephCluster extends K8sDockside.KubeObject {
    spec?: {
        cephVersion?: { image?: string; allowUnsupported?: boolean };
        /** `enable: true` is the mode where Ceph runs outside the cluster. */
        external?: { enable?: boolean };
        mon?: { count?: number; allowMultiplePerNode?: boolean; failureDomainLabel?: string };
        mgr?: { count?: number; modules?: { name?: string; enabled?: boolean }[] | null };
        dashboard?: { enabled?: boolean; port?: number; ssl?: boolean; urlPrefix?: string };
        monitoring?: { enabled?: boolean };
        network?: { provider?: string; hostNetwork?: boolean; connections?: { encryption?: { enabled?: boolean }; compression?: { enabled?: boolean } } };
        storage?: {
            useAllNodes?: boolean;
            useAllDevices?: boolean;
            deviceFilter?: string;
            nodes?: { name?: string }[] | null;
            storageClassDeviceSets?: { name?: string; count?: number; portable?: boolean }[] | null;
            store?: { type?: string };
        };
        dataDirHostPath?: string;
        /** Set to a non-empty confirmation when the cluster is being wiped. */
        cleanupPolicy?: { confirmation?: string };
        security?: { kms?: { connectionDetails?: Record<string, string> | null } };
    };
    status?: {
        state?: string;
        phase?: string;
        message?: string;
        conditions?: Condition[] | null;
        /** Rook's copy of `ceph status`. Absent until the first successful read. */
        ceph?: CephStatus | null;
        storage?: {
            deviceClasses?: { name?: string }[] | null;
            osd?: { storeType?: Record<string, number> | null; migrationStatus?: { pending?: number } };
        } | null;
        version?: { image?: string; version?: string } | null;
        observedGeneration?: number;
    };
}

/** What every pool -- a block pool's own, a filesystem's, an object store's -- is made of. */
export interface PoolSpec {
    failureDomain?: string;
    crushRoot?: string;
    deviceClass?: string;
    replicated?: { size?: number; requireSafeReplicaSize?: boolean; targetSizeRatio?: number; replicasPerFailureDomain?: number };
    erasureCoded?: { dataChunks?: number; codingChunks?: number; algorithm?: string };
    compressionMode?: string;
    parameters?: Record<string, string> | null;
    mirroring?: { enabled?: boolean; mode?: string; peers?: { secretNames?: string[] | null } };
    quotas?: { maxSize?: string; maxObjects?: number; maxBytes?: number };
    enableRBDStats?: boolean;
}

export interface NamedPoolSpec extends PoolSpec {
    name?: string;
}

export interface MirroringSummary {
    health?: string;
    daemon_health?: string;
    image_health?: string;
    states?: Record<string, number> | null;
}

export interface CephBlockPool extends K8sDockside.KubeObject {
    spec?: NamedPoolSpec;
    status?: {
        phase?: string;
        poolID?: number;
        info?: Record<string, string> | null;
        conditions?: Condition[] | null;
        mirroringStatus?: { summary?: MirroringSummary | null; lastChecked?: string; lastChanged?: string; details?: string } | null;
        observedGeneration?: number;
    };
}

export interface CephFilesystem extends K8sDockside.KubeObject {
    spec?: {
        metadataPool?: NamedPoolSpec;
        dataPools?: NamedPoolSpec[] | null;
        preservePoolsOnDelete?: boolean;
        preserveFilesystemOnDelete?: boolean;
        metadataServer?: { activeCount?: number; activeStandby?: boolean };
        mirroring?: { enabled?: boolean; peers?: { secretNames?: string[] | null } };
    };
    status?: {
        phase?: string;
        info?: Record<string, string> | null;
        conditions?: Condition[] | null;
        observedGeneration?: number;
    };
}

export interface CephObjectStore extends K8sDockside.KubeObject {
    spec?: {
        metadataPool?: PoolSpec;
        dataPool?: PoolSpec;
        sharedPools?: { metadataPoolName?: string; dataPoolName?: string; preserveRadosNamespaceDataOnDelete?: boolean };
        preservePoolsOnDelete?: boolean;
        gateway?: { port?: number; securePort?: number; instances?: number; sslCertificateRef?: string; hostNetwork?: boolean };
        zone?: { name?: string };
        hosting?: { advertiseEndpoint?: { dnsName?: string; port?: number; useTls?: boolean }; dnsNames?: string[] | null };
    };
    status?: {
        phase?: string;
        message?: string;
        replicas?: number;
        /** The addresses the RGW answers on, as Rook found them. */
        endpoints?: { insecure?: string[] | null; secure?: string[] | null };
        info?: Record<string, string> | null;
        conditions?: Condition[] | null;
        observedGeneration?: number;
    };
}

export interface CephNFS extends K8sDockside.KubeObject {
    spec?: {
        rados?: { pool?: string; namespace?: string };
        server?: { active?: number; logLevel?: string; hostNetwork?: boolean };
        security?: { kerberos?: unknown; sssd?: unknown };
    };
    status?: { phase?: string; conditions?: Condition[] | null; observedGeneration?: number };
}

export interface CephClient extends K8sDockside.KubeObject {
    spec?: { name?: string; secretName?: string; caps?: Record<string, string> | null };
    status?: { phase?: string; info?: Record<string, string> | null; observedGeneration?: number };
}

/** CephRBDMirror and CephFilesystemMirror both report only a phase. */
export interface CephMirror extends K8sDockside.KubeObject {
    spec?: { count?: number; peers?: { secretNames?: string[] | null } };
    status?: { phase?: string; conditions?: Condition[] | null };
}

/** The lib-bucket-provisioner claim an object store's buckets are asked for with. */
export interface ObjectBucketClaim extends K8sDockside.KubeObject {
    spec?: { bucketName?: string; generateBucketName?: string; storageClassName?: string; objectBucketName?: string };
    status?: { phase?: string };
}

/** A StorageClass, with the fields this plugin reads. */
export interface StorageClass extends K8sDockside.KubeObject {
    provisioner?: string;
    parameters?: Record<string, string> | null;
    reclaimPolicy?: string;
    volumeBindingMode?: string;
    allowVolumeExpansion?: boolean;
    mountOptions?: string[] | null;
}

export interface PersistentVolumeClaim extends K8sDockside.KubeObject {
    spec?: {
        storageClassName?: string;
        volumeName?: string;
        accessModes?: string[] | null;
        volumeMode?: string;
        resources?: { requests?: Record<string, string> | null };
    };
    status?: { phase?: string; capacity?: Record<string, string> | null; accessModes?: string[] | null };
}

export interface PersistentVolume extends K8sDockside.KubeObject {
    spec?: {
        storageClassName?: string;
        capacity?: Record<string, string> | null;
        persistentVolumeReclaimPolicy?: string;
        claimRef?: { namespace?: string; name?: string };
        csi?: { driver?: string; volumeHandle?: string; fsType?: string; volumeAttributes?: Record<string, string> | null };
    };
    status?: { phase?: string; message?: string };
}

export interface Pod extends K8sDockside.KubeObject {
    spec?: { nodeName?: string; containers?: { name?: string; image?: string }[] | null };
    status?: {
        phase?: string;
        message?: string;
        reason?: string;
        podIP?: string;
        startTime?: string;
        conditions?: Condition[] | null;
        containerStatuses?:
            | {
                  name?: string;
                  ready?: boolean;
                  restartCount?: number;
                  started?: boolean;
                  state?: { waiting?: { reason?: string; message?: string }; terminated?: { reason?: string; exitCode?: number }; running?: { startedAt?: string } };
              }[]
            | null;
    };
}

/** The condition of a type, from a list that may be absent altogether. */
export function condition(list: Condition[] | null | undefined, type: string): Condition | undefined {
    return (list ?? []).find((c) => (c.type ?? '').toLowerCase() === type.toLowerCase());
}

/**
 * How a pool keeps its data, in the words Ceph uses: "3 copies" or "EC 2+1".
 * A pool with neither is one Rook has not been told how to build.
 */
export function durability(pool: PoolSpec | undefined): string {
    const replicas = pool?.replicated?.size ?? 0;
    if (replicas > 0) return `${replicas} ${replicas === 1 ? 'copy' : 'copies'}`;
    const data = pool?.erasureCoded?.dataChunks ?? 0;
    const coding = pool?.erasureCoded?.codingChunks ?? 0;
    if (data > 0 || coding > 0) return `EC ${data}+${coding}`;
    return '';
}

/**
 * Whether a pool can lose a node without losing data.
 *
 * Replica 1 and EC with no coding chunks are both "one disk away from gone",
 * and Ceph will not tell you so on its own: `requireSafeReplicaSize` only
 * stops you creating one, it says nothing afterwards.
 */
export function fragile(pool: PoolSpec | undefined): boolean {
    const replicas = pool?.replicated?.size ?? 0;
    if (replicas === 1) return true;
    const coding = pool?.erasureCoded?.codingChunks ?? 0;
    const data = pool?.erasureCoded?.dataChunks ?? 0;
    return data > 0 && coding === 0;
}
