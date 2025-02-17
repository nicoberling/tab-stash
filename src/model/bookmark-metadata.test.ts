import {expect} from 'chai';

import * as events from '../mock/events';

import {KVSCache} from '../datastore/kvs';
import MemoryKVS from '../datastore/kvs/memory';
import {Model, BookmarkMetadata} from './bookmark-metadata';

describe('model/bookmark-metadata', () => {
    let kvc: KVSCache<string, BookmarkMetadata>;
    let model: Model;

    beforeEach(() => {
        kvc = new KVSCache(new MemoryKVS('bookmark_metadata'));
        model = new Model(kvc);
        events.ignore([
            kvc.kvs.onSet,
            kvc.kvs.onDelete,
        ]);
    });

    it('collapses bookmarks', () => {
        model.setCollapsed('foo', true);
        expect(kvc.get('foo').value).to.deep.equal({collapsed: true});
    });

    it('expands bookmarks', () => {
        model.setCollapsed('foo', true);
        expect(kvc.get('foo').value).to.deep.equal({collapsed: true});
        model.setCollapsed('foo', false);
        expect(kvc.get('foo').value).to.deep.equal({collapsed: false});
    });

    it('garbage-collects unused bookmarks', async () => {
        model.setCollapsed('foo', true);
        model.setCollapsed('bar', false);
        expect(kvc.get('foo').value).to.deep.equal({collapsed: true});
        expect(kvc.get('bar').value).to.deep.equal({collapsed: false});

        await kvc.sync();
        expect(await kvc.kvs.get(['foo', 'bar'])).to.deep.equal([
            {key: 'foo', value: {collapsed: true}},
            {key: 'bar', value: {collapsed: false}},
        ]);

        // now try to GC
        expect(await model.gc(id => id === 'foo'));
        expect(await kvc.kvs.get(['foo', 'bar'])).to.deep.equal([
            {key: 'foo', value: {collapsed: true}},
        ]);
    });
});
