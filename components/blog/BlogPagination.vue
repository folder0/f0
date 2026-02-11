<!--
  =============================================================================
  F0 - BLOG PAGINATION COMPONENT
  =============================================================================
  
  Simple Previous/Next pagination with page indicator.
  
  USAGE:
  <BlogPagination :current-page="1" :total-pages="5" @page-change="onPageChange" />
-->

<template>
  <div v-if="totalPages > 1" class="blog-pagination">
    <button
      class="blog-pagination-btn"
      :disabled="currentPage <= 1"
      @click="$emit('pageChange', currentPage - 1)"
    >
      ← Previous
    </button>
    
    <span class="blog-pagination-info">
      Page {{ currentPage }} of {{ totalPages }}
    </span>
    
    <button
      class="blog-pagination-btn"
      :disabled="currentPage >= totalPages"
      @click="$emit('pageChange', currentPage + 1)"
    >
      Next →
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  currentPage: number
  totalPages: number
}>()

defineEmits<{
  (e: 'pageChange', page: number): void
}>()
</script>
