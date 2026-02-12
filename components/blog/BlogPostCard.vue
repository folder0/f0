<!--
  F0 - BLOG POST CARD
  Clean list-item style. Title dominates, description supports, meta whispers.
-->

<template>
  <article class="post-card" :class="{ pinned: post.pinned }">
    <div class="post-card-body">
      <!-- Title row -->
      <h2 class="post-card-title">
        <NuxtLink :to="post.path">{{ post.title }}</NuxtLink>
      </h2>

      <!-- Excerpt -->
      <p v-if="post.excerpt" class="post-card-excerpt">{{ post.excerpt }}</p>

      <!-- Meta line: date · reading time · tags -->
      <div class="post-card-meta">
        <time class="post-card-date">{{ formatDate(post.date) }}</time>
        <span v-if="post.readingTime" class="meta-sep">&middot;</span>
        <span v-if="post.readingTime" class="post-card-reading">{{ post.readingTime }} min read</span>
        <template v-if="post.tags.length > 0">
          <span class="meta-sep">&middot;</span>
          <NuxtLink
            v-for="tag in post.tags.slice(0, 3)"
            :key="tag"
            :to="`${basePath}?tag=${encodeURIComponent(tag)}`"
            class="post-card-tag"
          >{{ tag }}</NuxtLink>
        </template>
      </div>
    </div>

    <!-- Cover image (if present) -->
    <img
      v-if="post.coverImage"
      :src="coverImageSrc"
      :alt="post.title"
      class="post-card-cover"
      loading="lazy"
    />
  </article>
</template>

<script setup lang="ts">
const props = defineProps<{
  post: {
    title: string
    slug: string
    path: string
    date: string
    author: string
    tags: string[]
    excerpt: string
    coverImage?: string
    pinned: boolean
    readingTime: number
  }
  basePath?: string
  dateFormat?: 'long' | 'short' | 'relative'
}>()

const basePath = computed(() => props.basePath || '/blog')

const coverImageSrc = computed(() => {
  if (!props.post.coverImage) return ''
  if (props.post.coverImage.startsWith('./') || props.post.coverImage.startsWith('../')) {
    return `/api/content/assets/${props.post.coverImage.replace(/^\.\//, '')}`
  }
  return props.post.coverImage
})

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}
</script>
