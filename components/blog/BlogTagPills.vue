<!--
  =============================================================================
  F0 - TAG PILLS COMPONENT
  =============================================================================
  
  Displays clickable tag pills for blog posts.
  
  USAGE:
  <BlogTagPills :tags="['engineering', 'f0']" :basePath="'/blog'" />
-->

<template>
  <div class="tag-pills-wrapper">
    <NuxtLink
      v-for="tag in tags"
      :key="tag"
      :to="tagLink(tag)"
      class="tag-pill"
      :class="[tagColorClass(tag), { active: activeTag === tag }]"
    >
      {{ tag }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  tags: string[]
  basePath?: string
  activeTag?: string
}>()

function tagLink(tag: string): string {
  const base = props.basePath || '/blog'
  return `${base}?tag=${encodeURIComponent(tag)}`
}

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash = hash & hash // Convert to 32bit integer
  }
  return `tag-color-${Math.abs(hash) % 10}`
}
</script>

<style scoped>
.tag-pills-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-1);
}
</style>
