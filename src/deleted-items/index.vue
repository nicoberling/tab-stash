<template>
<main>
    <header class="page action-container">
        <a class="action back" title="Back to Tab Stash"
           :href="pageref('stash-list.html')"></a>
        <input type="search" ref="search" class="ephemeral"
               placeholder="Search Deleted Items" aria-label="Search Deleted Items"
               @keyup.esc.prevent="search=''"
               v-model="search">
    </header>
    <div class="folder-list one-column">
        <section v-for="group of filter_results" :key="group.title" class="folder">
            <header>
                <div class="folder-name disabled">Deleted {{group.title}}</div>
            </header>
            <ul class="contents">
                <li v-for="rec of group.records" :key="rec.key">
                    <Folder v-if="'children' in rec.item" :deletion="rec" />
                    <Bookmark v-else :deletion="rec" />
                </li>
            </ul>
        </section>
    </div>
    <LoadMore is="footer" class="page footer status-text"
              :load="loadMore" :isFullyLoaded="state.fullyLoaded">
        <template #loading>
            <span class="spinner size-2x-icon" />
        </template>
        <template #fully-loaded>
            <span v-if="search && state.entries.length === 0">
                No matching items were found.  Your item may have been deleted
                on another computer, or outside of Tab Stash entirely.
            </span>
            <span v-else-if="state.entries.length === 0 && state.fullyLoaded">
                It doesn't look like you've deleted anything on this computer
                yet.
            </span>
            <span v-else>
                Didn't find what you're looking for?  It may have been deleted
                on another computer, or outside of Tab Stash entirely.
            </span>
        </template>
    </LoadMore>
</main>
</template>

<script lang="ts">
import {PropType, defineComponent} from 'vue';

import {filterMap, required, textMatcher} from '../util';
import {pageref} from '../launch-vue';
import {Model} from '../model';
import * as DI from '../model/deleted-items';

const date_formatter = new Intl.DateTimeFormat();

type RecordGroup = {title: string, records: FilteredDeletion[]};
type FilteredDeletion = DI.Deletion & {item: FilteredDeletedItem};
type FilteredDeletedItem = FilteredCount<DI.DeletedItem>;

type FilteredCount<F> = F & {filtered_count?: number};

export default defineComponent({
    components: {
        LoadMore: require('../components/load-more.vue').default,
        Bookmark: require('./bookmark.vue').default,
        ButtonBox: require('../components/button-box.vue').default,
        Folder: require('./folder.vue').default,
        ItemIcon: require('../components/item-icon.vue').default,
    },

    props: {
        state: required(Object as PropType<DI.State>),
    },

    data: () => ({
        search_text: '',
    }),

    computed: {
        record_groups(): RecordGroup[] {
            const ret: RecordGroup[] = [];
            let cutoff = this.startOfToday();
            let records: DI.Deletion[] = [];

            for (const r of this.state.entries) {
                while (r.deleted_at.valueOf() < cutoff.valueOf()) {
                    if (records.length > 0) {
                        ret.push({title: cutoff.toLocaleDateString(), records});
                    }
                    records = [];
                    cutoff = new Date(cutoff.valueOf() - 24*60*60*1000);
                }
                records.push(r);
            }
            if (records.length > 0) {
                ret.push({title: cutoff.toLocaleDateString(), records});
            }

            return ret;
        },

        search: {
            get(): string { return this.search_text; },
            set(t: string) {
                // We don't want to call filter() if search doesn't actually
                // change, because it will reset the model but then not load
                // anything (since the infinite-loader itself isn't reset).
                if (t !== this.search_text) {
                    this.search_text = t;
                    this.model().deleted_items.filter(this.item_filter);
                }
            },
        },

        text_matcher(): (txt: string) => boolean {
            return textMatcher(this.search);
        },

        item_mapper(): (item: DI.DeletedItem) => FilteredDeletedItem | undefined {
            const match = this.text_matcher;
            const mapitem = (item: FilteredDeletedItem): FilteredDeletedItem | undefined => {
                if (match(item.title)) return item;
                if ('url' in item && match(item.url)) return item;

                if ('children' in item) {
                    const mapped: FilteredDeletedItem = {
                        title: item.title,
                        children: filterMap(item.children, mapitem),
                    };
                    if (mapped.children.length === 0) return undefined;

                    mapped.filtered_count = item.children.length - mapped.children.length;
                    return mapped;
                }

                return undefined;
            };
            return mapitem;
        },

        item_filter(): (item: DI.DeletedItem) => boolean {
            const mapitem = this.item_mapper;
            return item => mapitem(item) !== undefined;
        },

        filter_results(): RecordGroup[] {
            if (! this.search) return this.record_groups;

            const mapitem = this.item_mapper;
            return filterMap(this.record_groups, rg => {
                const filtered = filterMap(rg.records, r => {
                    const i = mapitem(r.item);
                    if (i) return {
                        key: r.key,
                        deleted_at: r.deleted_at,
                        item: i,
                    };
                    return undefined;
                });
                if (filtered.length === 0) return undefined;

                return {
                    title: rg.title,
                    records: filtered,
                };
            });
        },
    },

    methods: {
        // Dummy which is overridden in launch() below...
        model(): Model { return (<any>this).$model; },
        pageref,

        loadMore() { return this.model().deleted_items.loadMore(); },

        startOfToday(): Date {
            const d = new Date();
            d.setMilliseconds(0);
            d.setSeconds(0);
            d.setMinutes(0);
            d.setHours(0);
            return d;
        },

        friendlyDay(d: Date): string {
            return date_formatter.format(d);
        }
    },
});
</script>
