// What Ceph is actually serving, and how safely.
//
// Everything in Ceph is a pool underneath -- an RBD image lives in one, a
// CephFS has two or more, an object store has a handful -- and the single
// most important fact about a pool is how many copies of the data it keeps.
// Ceph will happily run a pool with one copy and say HEALTH_OK about it right
// up until a disk dies, so this page says it out loud, in the one place where
// a person can compare every pool at once.

import { BLOCK_POOLS, FILESYSTEMS, NFSES, OBJECT_STORES, durability, fragile, type CephBlockPool, type CephFilesystem, type CephNFS, type CephObjectStore, type NamedPoolSpec, type PoolSpec } from '../model/rook.js';
import { poolName } from '../model/classes.js';
import { count } from '../model/units.js';
import { maybeList, every, start } from '../ui/page.js';
import { byId, el, replace } from '../ui/dom.js';
import { block, facts, heading, nothing, openName, pill } from '../ui/parts.js';

const REFRESH = 15_000;

start('page', async (ctx) => {
    replace(byId('head'), heading('Pools & filesystems', `What Ceph serves in ${ctx.contextName}, and how many copies of it there are.`));

    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });

    const stop = every(
        REFRESH,
        async () => {
            const [pools, filesystems, stores, nfses] = await Promise.all([
                maybeList<CephBlockPool>({ kind: BLOCK_POOLS }),
                maybeList<CephFilesystem>({ kind: FILESYSTEMS }),
                maybeList<CephObjectStore>({ kind: OBJECT_STORES }),
                maybeList<CephNFS>({ kind: NFSES }),
            ]);
            failure.textContent = '';
            document.getElementById('first')?.remove();

            if (pools.length + filesystems.length + stores.length + nfses.length === 0) {
                replace(
                    body,
                    failure,
                    block(
                        'Nothing here yet',
                        'This cluster has no CephBlockPool, CephFilesystem, CephObjectStore or CephNFS. Either Rook is not managing Ceph from here, or nothing has been asked of it yet.',
                        nothing('A cluster that only consumes an external Ceph has none of these — the pools are defined wherever Ceph itself is.'),
                    ),
                );
                return;
            }

            replace(body, failure, poolsBlock(pools), filesystemsBlock(filesystems), storesBlock(stores), nfsBlock(nfses));
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

/** The word for a phase, and whether it is a good one. */
function phasePill(phase: string | undefined): HTMLElement | null {
    if (!phase) return null;
    const good = phase === 'Ready' || phase === 'Connected';
    return pill(phase, good ? 'ok' : phase === 'Progressing' ? 'warn' : 'error');
}

/** How a pool keeps its data, as a pill that says whether that is enough. */
function durabilityPill(spec: PoolSpec | undefined): HTMLElement {
    const words = durability(spec);
    if (!words) return pill('layout not set', 'warn', 'Neither replicated.size nor erasureCoded is set on this pool');
    return pill(words, fragile(spec) ? 'error' : 'ok', fragile(spec) ? 'One failed OSD loses the data in this pool' : 'The data survives a failure');
}

function poolsBlock(pools: CephBlockPool[]): HTMLElement {
    if (pools.length === 0) return block('Block pools', '', nothing('No CephBlockPool. RBD storage classes have nothing here to provision from.'));

    const cards = pools
        .slice()
        .sort((a, b) => poolName(a).localeCompare(poolName(b)))
        .map((pool) => {
            const mirror = pool.status?.mirroringStatus?.summary?.health ?? '';
            const fragileHere = fragile(pool.spec);
            return el(
                'article',
                { class: `card tone-edge-${fragileHere ? 'error' : (pool.status?.phase ?? '') === 'Ready' ? 'ok' : 'warn'}` },
                el(
                    'div',
                    { class: 'card-head' },
                    openName(poolName(pool), { kind: BLOCK_POOLS, namespace: pool.metadata.namespace ?? '', name: pool.metadata.name }, 'card-name'),
                    el('span', { class: 'spacer' }),
                    durabilityPill(pool.spec),
                    phasePill(pool.status?.phase),
                ),
                facts([
                    ['Failure domain', pool.spec?.failureDomain || 'host (Ceph‘s default)'],
                    ['Device class', pool.spec?.deviceClass || 'any'],
                    ['Compression', pool.spec?.compressionMode || 'off'],
                    ['Pool id', pool.status?.poolID !== undefined ? String(pool.status.poolID) : '—'],
                    ...(pool.spec?.mirroring?.enabled
                        ? ([['Mirroring', el('span', {}, pool.spec.mirroring.mode || 'on', mirror ? pill(mirror, mirror === 'OK' ? 'ok' : 'error') : null)]] as [string, Node][])
                        : []),
                    ...(pool.spec?.quotas?.maxSize ? ([['Quota', pool.spec.quotas.maxSize]] as [string, string][]) : []),
                ]),
                fragileHere
                    ? el(
                          'p',
                          { class: 'card-problem' },
                          `${durability(pool.spec)} means one failed OSD loses everything in this pool. Ceph will not warn about it — requireSafeReplicaSize only stops you creating one.`,
                      )
                    : null,
            );
        });

    return block(
        'Block pools',
        'What RBD volumes are cut out of. The redundancy pill is how many copies of each object the pool keeps — that is what survives a dead disk, not the health status.',
        el('div', { class: 'wide' }, ...cards),
    );
}

function filesystemsBlock(filesystems: CephFilesystem[]): HTMLElement | null {
    if (filesystems.length === 0) return null;

    const cards = filesystems.map((fs) => {
        const mds = fs.spec?.metadataServer;
        const active = mds?.activeCount ?? 0;
        const dataPools: NamedPoolSpec[] = fs.spec?.dataPools ?? [];
        return el(
            'article',
            { class: `card tone-edge-${(fs.status?.phase ?? '') === 'Ready' ? 'ok' : 'warn'}` },
            el(
                'div',
                { class: 'card-head' },
                openName(fs.metadata.name, { kind: FILESYSTEMS, namespace: fs.metadata.namespace ?? '', name: fs.metadata.name }, 'card-name'),
                el('span', { class: 'spacer' }),
                pill(`${count(active, 'active MDS', 'active MDS')}`, active > 0 ? 'ok' : 'error', 'Metadata servers serving this filesystem'),
                mds?.activeStandby ? pill('with standbys', 'ok', 'Each active MDS has a standby ready to take over') : pill('no standbys', 'warn', 'An MDS failure means a pause until one is restarted'),
                phasePill(fs.status?.phase),
            ),
            facts([
                ['Metadata pool', el('span', {}, fs.spec?.metadataPool?.name || `${fs.metadata.name}-metadata`, ' — ', durabilityPill(fs.spec?.metadataPool))],
                [
                    'Data pools',
                    dataPools.length === 0
                        ? '—'
                        : el(
                              'span',
                              {},
                              ...dataPools.flatMap((pool, index) => [
                                  index > 0 ? el('span', {}, ', ') : null,
                                  el('span', { class: 'mono' }, pool.name || `${fs.metadata.name}-data${index}`),
                                  el('span', {}, ' '),
                                  durabilityPill(pool),
                              ]).filter((node): node is HTMLElement => node !== null),
                          ),
                ],
                ['Mirroring', fs.spec?.mirroring?.enabled ? 'on' : 'off'],
            ]),
            dataPools.some(fragile) || fragile(fs.spec?.metadataPool)
                ? el('p', { class: 'card-problem' }, 'One of this filesystem‘s pools keeps a single copy. Losing one OSD loses what is in it — the metadata pool most of all.')
                : null,
        );
    });

    return block(
        'Filesystems (CephFS)',
        'What shared-file storage classes provision from. A filesystem needs its metadata servers up to be mountable at all, and each one holds a metadata pool and one or more data pools.',
        el('div', { class: 'wide' }, ...cards),
    );
}

function storesBlock(stores: CephObjectStore[]): HTMLElement | null {
    if (stores.length === 0) return null;

    const cards = stores.map((store) => {
        const endpoints = [...(store.status?.endpoints?.secure ?? []), ...(store.status?.endpoints?.insecure ?? [])];
        return el(
            'article',
            { class: `card tone-edge-${(store.status?.phase ?? '') === 'Ready' || (store.status?.phase ?? '') === 'Connected' ? 'ok' : 'warn'}` },
            el(
                'div',
                { class: 'card-head' },
                openName(store.metadata.name, { kind: OBJECT_STORES, namespace: store.metadata.namespace ?? '', name: store.metadata.name }, 'card-name'),
                el('span', { class: 'spacer' }),
                pill(count(store.status?.replicas ?? store.spec?.gateway?.instances ?? 0, 'gateway'), (store.status?.replicas ?? 0) > 0 ? 'ok' : 'warn'),
                phasePill(store.status?.phase),
            ),
            facts([
                ['S3 endpoints', endpoints.length ? el('span', { class: 'mono' }, endpoints.join(', ')) : 'none reported'],
                ['Metadata pool', durabilityPill(store.spec?.metadataPool)],
                ['Data pool', durabilityPill(store.spec?.dataPool)],
                ['Shared pools', store.spec?.sharedPools?.dataPoolName || store.spec?.sharedPools?.metadataPoolName ? 'yes' : 'no'],
                ['Zone', store.spec?.zone?.name || '—'],
            ]),
            store.status?.message ? el('p', { class: 'card-problem' }, store.status.message) : null,
        );
    });

    return block('Object stores (RGW)', 'The S3 endpoints. Bucket storage classes make their buckets in one of these, through an ObjectBucketClaim.', el('div', { class: 'wide' }, ...cards));
}

function nfsBlock(nfses: CephNFS[]): HTMLElement | null {
    if (nfses.length === 0) return null;

    const cards = nfses.map((nfs) =>
        el(
            'article',
            { class: `card tone-edge-${(nfs.status?.phase ?? '') === 'Ready' ? 'ok' : 'warn'}` },
            el(
                'div',
                { class: 'card-head' },
                openName(nfs.metadata.name, { kind: NFSES, namespace: nfs.metadata.namespace ?? '', name: nfs.metadata.name }, 'card-name'),
                el('span', { class: 'spacer' }),
                pill(count(nfs.spec?.server?.active ?? 0, 'active server'), (nfs.spec?.server?.active ?? 0) > 0 ? 'ok' : 'warn'),
                phasePill(nfs.status?.phase),
            ),
            facts([
                ['RADOS pool', nfs.spec?.rados?.pool || '—'],
                ['RADOS namespace', nfs.spec?.rados?.namespace || '—'],
                ['Service name', el('span', { class: 'mono' }, `rook-ceph-nfs-${nfs.metadata.name}-a`)],
            ]),
        ),
    );

    return block(
        'NFS servers',
        'Ganesha servers exporting CephFS over NFS. An NFS storage class names one of these in its nfsCluster parameter and the matching Service in its server parameter.',
        el('div', { class: 'wide' }, ...cards),
    );
}
