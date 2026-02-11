<!--
  =============================================================================
  F0 - POST CARD COMPONENT
  =============================================================================
  
  Individual post card for the blog index grid.
  Shows cover image, title, excerpt, metadata, and tag pills.
  
  USAGE:
  <BlogPostCard :post="post" :basePath="'/blog'" :dateFormat="'long'" />
-->

<template>
  <article class="post-card" :class="{ pinned: post.pinned }">
    <!-- Cover image -->
    <img
      v-if="post.coverImage"
      :src="coverImageSrc"
      :alt="post.title"
      class="post-card-cover"
      loading="lazy"
    />
    
    <div class="post-card-body">
      <!-- Pinned badge -->
      <div v-if="post.pinned" class="post-card-pinned-badge">
        📌 Pinned
      </div>
      
      <!-- Tags -->
      <div v-if="post.tags.length > 0" class="post-card-tags">
        <NuxtLink
          v-for="tag in post.tags.slice(0, 3)"
          :key="tag"
          :to="`${basePath}?tag=${encodeURIComponent(tag)}`"
          class="tag-pill"
          :class="tagColorClass(tag)"
        >
          {{ tag }}
        </NuxtLink>
      </div>
      
      <!-- Title -->
      <h2 class="post-card-title">
        <NuxtLink :to="post.path">{{ post.title }}</NuxtLink>
      </h2>
      
      <!-- Excerpt -->
      <p class="post-card-excerpt">{{ post.excerpt }}</p>
      
      <!-- Meta -->
      <div class="post-card-meta">
        <span v-if="post.author">{{ post.author }}</span>
        <span v-if="post.author" class="meta-separator">·</span>
        <span class="blog-date">{{ formatDate(post.date) }}</span>
        <span class="meta-separator">·</span>
        <span>{{ post.readingTime }} min read</span>
      </div>
    </div>
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
  // Handle relative paths
  if (props.post.coverImage.startsWith('./') || props.post.coverImage.startsWith('../')) {
    return `/api/content/assets/${props.post.coverImage.replace(/^\.\//, '')}`
  }
  return props.post.coverImage
})

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash = hash & hash
  }
  return `tag-color-${Math.abs(hash) % 10}`
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    const format = props.dateFormat || 'long'
    
    if (format === 'relative') {
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      
      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
      return `${Math.floor(diffDays / 365)} years ago`
    }
    
    if (format === 'short') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    
    // long format
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}
</script>
