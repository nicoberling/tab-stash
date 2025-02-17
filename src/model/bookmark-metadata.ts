import {KVSCache, Entry} from '../datastore/kvs';

/** The key is the bookmark ID, and the value is the metadata. */
export type BookmarkMetadataEntry = Entry<string, BookmarkMetadata | null>;

/** Metadata stored locally (i.e. not synced) about a particular bookmark. */
export type BookmarkMetadata = {
    /** For folders, should the folder be shown as collapsed in the UI? */
    collapsed?: boolean;
};

/** Keeps track of bookmark metadata in local storage.  Right now this just
 * tracks whether folders should be shown as collapsed or expanded, but more
 * could be added later if needed. */
export class Model {
    private readonly _kvc: KVSCache<string, BookmarkMetadata>;

    constructor(kvc: KVSCache<string, BookmarkMetadata>) {
        this._kvc = kvc;
    }

    get(id: string): BookmarkMetadataEntry { return this._kvc.get(id); }

    set(id: string, metadata: BookmarkMetadata): BookmarkMetadataEntry {
        return this._kvc.set(id, metadata);
    }

    setCollapsed(id: string, collapsed: boolean) {
        this.set(id, {...this.get(id).value || {}, collapsed});
    }

    /** Remove metadata for bookmarks for whom `keep(id)` returns false. */
    async gc(keep: (id: string) => boolean) {
        const toDelete = [];
        for await (const ent of this._kvc.kvs.list()) {
            if (keep(ent.key)) continue;
            toDelete.push(ent.key);
        }

        await this._kvc.kvs.delete(toDelete);
    }
}
