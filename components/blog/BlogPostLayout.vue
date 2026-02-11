<!--
  =============================================================================
  F0 - BLOG POST LAYOUT COMPONENT
  =============================================================================
  
  Single-post reading view with cover image, byline, content body,
  and previous/next navigation.
  
  USAGE:
  <BlogPostLayout :content="contentResponse" />
-->

<template>
  <div class="blog-post-layout">
    <!-- Cover Image -->
    <img
      v-if="content.blog?.coverImage"
      :src="coverImageSrc"
      :alt="content.title"
      class="blog-post-cover"
    />
    
    <!-- Header -->
    <header class="blog-post-header">
      <!-- Tags -->
      <div v-if="content.blog?.tags?.length" class="blog-post-header-tags">
        <NuxtLink
          v-for="tag in content.blog.tags"
          :key="tag"
          :to="`${blogBasePath}?tag=${encodeURIComponent(tag)}`"
          class="tag-pill"
          :class="tagColorClass(tag)"
        >
          {{ tag }}
        </NuxtLink>
      </div>
      
      <!-- Title -->
      <h1 class="blog-post-title">{{ content.title }}</h1>
      
      <!-- Byline -->
      <div class="blog-post-byline">
        <span v-if="content.blog?.author">{{ content.blog.author }}</span>
        <span v-if="content.blog?.author" class="byline-separator">·</span>
        <span class="blog-date">{{ formattedDate }}</span>
        <span v-if="content.blog?.readingTime" class="byline-separator">·</span>
        <span v-if="content.blog?.readingTime">{{ content.blog.readingTime }} min read</span>
      </div>
    </header>
    
    <!-- Post body — same MarkdownRenderer as docs, but strip the H1 since we render our own header -->
    <div class="blog-post-body">
      <ContentMarkdownRenderer
        :html="bodyHtml"
        :toc="content.toc || []"
        :title="''"
        :markdown="content.markdown"
        :path="content.path"
      />
    </div>
    
    <!-- Previous / Next Post Navigation -->
    <nav v-if="prevPost || nextPost" class="blog-post-nav">
      <NuxtLink v-if="prevPost" :to="prevPost.path" class="blog-post-nav-link prev">
        <span class="blog-post-nav-label">← Previous</span>
        <span class="blog-post-nav-title">{{ prevPost.title }}</span>
      </NuxtLink>
      <NuxtLink v-if="nextPost" :to="nextPost.path" class="blog-post-nav-link next">
        <span class="blog-post-nav-label">Next →</span>
        <span class="blog-post-nav-title">{{ nextPost.title }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import type { TocItem } from '~/server/utils/markdown'

interface BlogMeta {
  date: string
  author: string
  tags: string[]
  coverImage?: string
  excerpt: string
  pinned: boolean
  readingTime: number
}

interface ContentResponse {
  type: string
  title: string
  html?: string
  toc?: TocItem[]
  markdown?: string
  path?: string
  layout?: string
  blog?: BlogMeta
}

const props = defineProps<{
  content: ContentResponse
}>()

// Derive the blog section base path from the content path
const blogBasePath = computed(() => {
  const path = props.content.path || ''
  const segments = path.split('/').filter(Boolean)
  if (segments.length > 1) {
    return '/' + segments[0]
  }
  return '/'
})

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash = hash & hash
  }
  return `tag-color-${Math.abs(hash) % 10}`
}

// Strip the first H1 from rendered HTML since PostLayout renders its own title header
const bodyHtml = computed(() => {
  const html = props.content.html || ''
  return html.replace(/<h1[^>]*>.*?<\/h1>/, '')
})

// Cover image source
const coverImageSrc = computed(() => {
  const img = props.content.blog?.coverImage
  if (!img) return ''
  if (img.startsWith('./') || img.startsWith('../')) {
    return `/api/content/assets/${img.replace(/^\.\//, '')}`
  }
  return img
})

// Format date
const formattedDate = computed(() => {
  const dateStr = props.content.blog?.date
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
})

// Fetch adjacent posts for prev/next navigation
const { data: blogData } = await useFetch<{
  posts: Array<{ title: string; path: string; date: string }>
}>('/api/blog', {
  query: { path: blogBasePath },
})

const prevPost = computed(() => {
  if (!blogData.value?.posts || !props.content.path) return null
  const posts = blogData.value.posts
  const idx = posts.findIndex(p => p.path === props.content.path)
  if (idx > 0) return posts[idx - 1]
  return null
})

const nextPost = computed(() => {
  if (!blogData.value?.posts || !props.content.path) return null
  const posts = blogData.value.posts
  const idx = posts.findIndex(p => p.path === props.content.path)
  if (idx >= 0 && idx < posts.length - 1) return posts[idx + 1]
  return null
})
</script>
