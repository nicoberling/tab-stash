<template>
<a class="action" :title="tooltip"
        @click.prevent.stop="act">
  <!-- XXX do something with {{name}} for blind users -->
  </a>
</template>

<script lang="ts">
export default {
    emits: ['action'],
    props: {
        name: String,
        tooltip: String,
    },
    methods: {
        act: function(this: any, ev: any) { this.$emit('action', ev); }
    }
}
</script>

<style>
</style>
