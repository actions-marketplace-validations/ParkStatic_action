<script setup>
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <main>
    <h1 data-testid="marker">Hello from the Vite Vue SPA fixture</h1>
    <p>This text is rendered by Vue and must survive the prerender crawl.</p>
    <button type="button" @click="count++">count is {{ count }}</button>
  </main>
</template>
