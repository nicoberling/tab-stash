<template>
  <ProgressDialog v-if="progress" :progress="progress" :cancel="cancel"/>
  <Dialog v-else :class="{[$style.dlg]: true, 'import-dialog': true}"
          @close="$emit('close')">
    <template #title><span class="group-title">Import</span></template>
    <label for="data">
      Paste anything containing links or URLs here.  Links and URLs will be
      extracted and converted into bookmarks in your stash.
    </label>
    <div ref="data" contenteditable="true" id="data"
        :class="{'input': true, [$style.input]: true}" />
    <form :class="$style.split_mode">
      <label for="splitOn">Split tabs into different groups on:</label>
      <select id="splitOn" v-model="splitOn">
        <option value="p+h">Paragraphs and Headers</option>
        <option value="h">Headers</option>
        <option value="">Nothing [all in one group]</option>
      </select>
    </form>
    <template #buttons>
        <button class="clickme" @click="start">Import</button>
    </template>
  </Dialog>
</template>

<script lang="ts">
import {defineComponent} from 'vue';
import {ParseOptions, parse, importURLs} from './import';
import { TaskMonitor } from '../util';
import {Model} from '../model';

export default defineComponent({
    components: {
        Dialog: require('../components/dialog.vue').default,
        ProgressDialog: require('../components/progress-dialog.vue').default,
    },

    emits: ['close'],

    data: () => ({
        cancel: undefined,
        progress: undefined,
        splitOn: 'p+h' as ParseOptions['splitOn'],
    }),

    inject: ['$model'],

    mounted() { (<HTMLElement>this.$refs.data).focus(); },

    methods: {
        model(): Model { return (<any>this).$model as Model },

        start() {
            const groups = parse(
                this.$refs.data as Element, this.model(), {splitOn: this.splitOn});

            const task = TaskMonitor.run(tm =>
                importURLs(this.model(), groups, tm)
                    .finally(() => this.$emit('close')));

            (<any>this).cancel = () => task.cancel();
            (<any>this).progress = task.progress;
        }
    }
});
</script>

<style module>
.dlg {
    width: 60rem;
    min-height: 20rem;
    height: 67%;
}

.dlg :global(.dialog-content) {
    grid-template-columns: 1fr;
    grid-template-rows: 0fr 1fr;
}

.dlg .input {
    cursor: text;
}

.split_mode {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
}
</style>
