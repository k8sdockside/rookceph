// The storage class map: every way this cluster can ask Ceph for storage.
//
// Grouped by what the class actually hands a workload rather than by driver
// name, because "rook-ceph.cephfs.csi.ceph.com" is not what anyone is looking
// for -- "the one that gives me a volume several pods can write to at once"
// is. Under each class: what it provisions from, whether that thing is in
// this cluster, how the data is kept, and who is using it.
//
// It works with no Rook at all. On a client-only cluster the backing objects
// are simply absent, which is drawn as "provisioned from a Ceph outside this
// cluster" rather than as an error, because that is what it is.

import { classViews, KIND_ORDER, KIND_WORDS, poolName, type ClassView } from '../model/classes.js';
import {
    BLOCK_POOLS,
    BUCKET_CLAIMS,
    CLUSTERS,
    durability,
    FILESYSTEMS,
    fragile,
    NFSES,
    OBJECT_STORES,
    PVCS,
    STORAGE_CLASSES,
    type CephBlockPool,
    type CephCluster,
    type CephFilesystem,
    type CephNFS,
    type CephObjectStore,
    type ObjectBucketClaim,
    type PersistentVolumeClaim,
    type StorageClass,
} from '../model/rook.js';
import { size } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { every, maybeList, start } from '../ui/page.js';
import { facts, heading, nothing, openName, param, pill } from '../ui/parts.js';

const REFRESH = 15_000;

/** What the search box holds, kept out of the redraw so typing survives a poll. */
let query = '';

start('page', async (ctx) => {
    replace(byId('head'), heading('Storage classes', `Every way ${ctx.contextName} can ask Ceph for storage, by what it hands a workload.`));

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const count = el('span', { class: 'count' });

    const search = el('input', { type: 'search', placeholder: 'Search class, pool, filesystem or driver…', 'aria-label': 'Search storage classes' }) as HTMLInputElement;
    let latest: ClassView[] = [];
    let claims: ObjectBucketClaim[] = [];
    search.addEventListener('input', () => {
        query = search.value.trim().toLowerCase();
        render(body, latest, claims, count);
    });
    replace(byId('bar'), search, count);

    const stop = every(
        REFRESH,
        async () => {
            const [storageClasses, clusters, pools, filesystems, objectStores, nfses, pvcs, obcs] = await Promise.all([
                maybeList<StorageClass>({ kind: STORAGE_CLASSES }),
                maybeList<CephCluster>({ kind: CLUSTERS }),
                maybeList<CephBlockPool>({ kind: BLOCK_POOLS }),
                maybeList<CephFilesystem>({ kind: FILESYSTEMS }),
                maybeList<CephObjectStore>({ kind: OBJECT_STORES }),
                maybeList<CephNFS>({ kind: NFSES }),
                maybeList<PersistentVolumeClaim>({ kind: PVCS }),
                maybeList<ObjectBucketClaim>({ kind: BUCKET_CLAIMS }),
            ]);
            failure.textContent = '';
            document.getElementById('first')?.remove();
            latest = classViews(storageClasses, { clusters, pools, filesystems, objectStores, nfses, claims: pvcs });
            claims = obcs;
            render(body, latest, claims, count);
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);

    // The failure line lives above the body so a poll that fails does not
    // wipe the map that is already on screen.
    byId('page').insertBefore(failure, body);
});

/** Everything about a class the search box should be able to find it by. */
function matches(view: ClassView): boolean {
    if (!query) return true;
    const haystack = [
        view.name,
        view.provisioner,
        view.kind,
        KIND_WORDS[view.kind].label,
        view.backing.pool,
        view.backing.dataPool,
        view.backing.fsName,
        view.backing.objectStore,
        view.backing.nfsCluster,
        view.backing.clusterID,
        view.backing.fsType,
    ]
        .join(' ')
        .toLowerCase();
    return haystack.includes(query);
}

function render(host: HTMLElement, views: ClassView[], buckets: ObjectBucketClaim[], count: HTMLElement): void {
    const shown = views.filter(matches);
    count.textContent = views.length === shown.length ? `${views.length} class${views.length === 1 ? '' : 'es'}` : `${shown.length} of ${views.length}`;

    if (views.length === 0) {
        replace(
            host,
            nothing(
                'No storage class in this cluster provisions from Ceph. A Ceph class is one whose provisioner ends in rbd.csi.ceph.com, cephfs.csi.ceph.com, nfs.csi.ceph.com or ceph.rook.io/bucket.',
            ),
        );
        return;
    }
    if (shown.length === 0) {
        replace(host, nothing(`Nothing matches “${query}”.`));
        return;
    }

    const sections: Node[] = [];
    for (const kind of KIND_ORDER) {
        const mine = shown.filter((view) => view.kind === kind);
        if (mine.length === 0) continue;
        sections.push(
            el(
                'div',
                { class: 'kind-head' },
                el('h2', {}, KIND_WORDS[kind].label),
                el('span', { class: 'kind-gives' }, `${mine.length} class${mine.length === 1 ? '' : 'es'} — ${KIND_WORDS[kind].gives}`),
            ),
            el('div', { class: 'wide' }, ...mine.map((view) => card(view, buckets))),
        );
    }
    replace(host, ...sections);
}

function card(view: ClassView, buckets: ObjectBucketClaim[]): HTMLElement {
    return el(
        'article',
        { class: `card tone-edge-${view.tone || 'none'}` },
        el(
            'div',
            { class: 'card-head' },
            openName(view.name, { kind: STORAGE_CLASSES, name: view.name }),
            view.isDefault ? pill('default', 'info', 'New claims that name no class get this one') : null,
            el('span', { class: 'spacer' }),
            view.backing.encrypted ? pill('encrypted', 'ok', 'The CSI driver encrypts each volume') : null,
        ),
        el('p', { class: 'card-for' }, el('span', { class: 'mono' }, view.provisioner)),
        backingRow(view),
        numbers(view, buckets),
        parameters(view),
        view.problem ? el('p', { class: 'card-problem' }, view.problem) : null,
        el(
            'p',
            { class: 'card-foot' },
            pill(view.reclaim === 'Retain' ? 'retain' : view.reclaim.toLowerCase(), view.reclaim === 'Retain' ? 'info' : '', `Reclaim policy: what happens to the Ceph image or subvolume when the claim is deleted`),
            pill(view.binding === 'WaitForFirstConsumer' ? 'binds on first pod' : 'binds at once', '', `volumeBindingMode: ${view.binding}`),
            pill(view.expansion ? 'expandable' : 'fixed size', view.expansion ? 'ok' : '', view.expansion ? 'A claim on this class can be grown' : 'allowVolumeExpansion is not set: claims cannot be grown'),
            view.backing.fsType ? pill(view.backing.fsType, '', 'The filesystem the driver formats the volume with') : null,
        ),
    );
}

/**
 * What the class provisions from, as links where the object is here.
 *
 * The `clusterID` parameter is a *namespace*, not a name -- that is how
 * ceph-csi is told which Ceph to talk to -- so the CephCluster is looked up
 * by it and shown by its own name, which is what someone would search for.
 */
function backingRow(view: ClassView): HTMLElement {
    const pairs: [string, Node | string][] = [];

    if (view.cluster) {
        pairs.push([
            'Ceph cluster',
            openName(view.cluster.metadata.name, { kind: CLUSTERS, namespace: view.cluster.metadata.namespace ?? '', name: view.cluster.metadata.name }, 'card-name'),
        ]);
    } else if (view.backing.clusterID) {
        pairs.push(['Ceph cluster', el('span', { class: 'faint' }, `cluster id ${view.backing.clusterID} — not in this Kubernetes cluster`)]);
    }

    if (view.kind === 'block') {
        pairs.push(['Pool', view.pool ? poolLink(view.pool) : plain(view.backing.pool)]);
        if (view.backing.dataPool) pairs.push(['Erasure-coded data pool', plain(view.backing.dataPool)]);
        if (view.backing.imageFeatures) pairs.push(['RBD image features', plain(view.backing.imageFeatures)]);
    }
    if (view.kind === 'file') {
        pairs.push(['Filesystem', view.filesystem ? fsLink(view.filesystem) : plain(view.backing.fsName)]);
        pairs.push(['Data pool', plain(view.backing.pool)]);
        if (view.filesystem) {
            const active = view.filesystem.spec?.metadataServer?.activeCount ?? 0;
            pairs.push(['Metadata servers', `${active} active${view.filesystem.spec?.metadataServer?.activeStandby ? ', each with a standby' : ''}`]);
        }
    }
    if (view.kind === 'nfs') {
        pairs.push(['NFS server', view.nfs ? nfsLink(view.nfs) : plain(view.backing.nfsCluster)]);
        pairs.push(['Address', plain(view.backing.server)]);
        pairs.push(['Filesystem', view.filesystem ? fsLink(view.filesystem) : plain(view.backing.fsName)]);
    }
    if (view.kind === 'bucket') {
        pairs.push(['Object store', view.objectStore ? storeLink(view.objectStore) : plain(view.backing.objectStore)]);
        const endpoints = [...(view.objectStore?.status?.endpoints?.secure ?? []), ...(view.objectStore?.status?.endpoints?.insecure ?? [])];
        if (endpoints.length) pairs.push(['S3 endpoint', el('span', { class: 'mono' }, endpoints[0] ?? '')]);
    }

    // What the data survives. Only knowable when the pool is in this cluster.
    const pool = view.kind === 'file' ? null : view.pool;
    if (pool) {
        const words = durability(pool.spec);
        pairs.push([
            'Redundancy',
            el(
                'span',
                {},
                words || '—',
                pool.spec?.failureDomain ? el('span', { class: 'faint' }, ` across ${pool.spec.failureDomain}s`) : null,
                fragile(pool.spec) ? el('span', { class: 'tone-warn' }, ' — one failure loses it') : null,
            ),
        ]);
    }

    return pairs.length > 0 ? facts(pairs) : el('p', { class: 'faint' }, 'This class names nothing this plugin recognises.');
}

function plain(value: string): Node {
    return value ? el('span', { class: 'mono' }, value) : el('span', { class: 'faint' }, 'not set');
}

function poolLink(pool: CephBlockPool): Node {
    return openName(poolName(pool), { kind: BLOCK_POOLS, namespace: pool.metadata.namespace ?? '', name: pool.metadata.name }, 'card-name');
}

function fsLink(fs: CephFilesystem): Node {
    return openName(fs.metadata.name, { kind: FILESYSTEMS, namespace: fs.metadata.namespace ?? '', name: fs.metadata.name }, 'card-name');
}

function storeLink(store: CephObjectStore): Node {
    return openName(store.metadata.name, { kind: OBJECT_STORES, namespace: store.metadata.namespace ?? '', name: store.metadata.name }, 'card-name');
}

function nfsLink(nfs: CephNFS): Node {
    return openName(nfs.metadata.name, { kind: NFSES, namespace: nfs.metadata.namespace ?? '', name: nfs.metadata.name }, 'card-name');
}

/** Who is using this class, and for how much. */
function numbers(view: ClassView, buckets: ObjectBucketClaim[]): HTMLElement {
    if (view.kind === 'bucket') {
        const mine = buckets.filter((claim) => claim.spec?.storageClassName === view.name);
        const bound = mine.filter((claim) => (claim.status?.phase ?? '') === 'Bound').length;
        const row = el(
            'p',
            { class: 'numbers' },
            el('span', {}, el('strong', {}, String(mine.length)), ` bucket claim${mine.length === 1 ? '' : 's'}`),
            el('span', {}, el('strong', {}, String(bound)), ' bound'),
        );
        return row;
    }
    return el(
        'p',
        { class: 'numbers' },
        el('span', {}, el('strong', {}, String(view.claims)), ` claim${view.claims === 1 ? '' : 's'}`),
        view.pending > 0 ? el('span', { class: 'tone-warn' }, el('strong', {}, String(view.pending)), ' pending') : null,
        el('span', {}, el('strong', {}, size(view.requested)), ' bound'),
    );
}

/**
 * The CSI parameters, as they are actually written.
 *
 * Shown in full and unedited on purpose: when a class does not work, the
 * answer is nearly always a parameter that does not say what its author
 * thought it said, and a page that summarises them away is a page you have to
 * leave to debug anything.
 */
function parameters(view: ClassView): HTMLElement | null {
    const entries = Object.entries(view.storageClass.parameters ?? {})
        // The secret references are six near-identical lines of plumbing that
        // are the same on every class Rook makes. They are on the object, and
        // the panel in the detail view shows them; here they would bury the
        // three parameters that differ.
        .filter(([name]) => !name.startsWith('csi.storage.k8s.io/'))
        .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return null;

    const details = el('details', { class: 'params-details' });
    details.append(
        el('summary', { class: 'card-label' }, `${entries.length} parameter${entries.length === 1 ? '' : 's'}`),
        el('ul', { class: 'params' }, ...entries.map(([name, value]) => param(name, value))),
    );
    return details;
}
