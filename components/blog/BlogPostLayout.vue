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
  prev?: { title: string; path: string } | null
  next?: { title: string; path: string } | null
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

// The blog this post belongs to: its URL without the last segment (nested
// blogs such as /guides/changelog included)
const blogBasePath = computed(() => {
  const segments = (props.content.path || '').split('/').filter(Boolean)
  return segments.length > 1 ? '/' + segments.slice(0, -1).join('/') : '/'
})

useFeedLinks(blogBasePath)

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
// The server resolves cover_image to its URL (same rule as body images)
const coverImageSrc = computed(() => props.content.blog?.coverImage || '')

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

// Previous and next posts come with the post (from the folder's full list)
const prevPost = computed(() => props.content.blog?.prev ?? null)
const nextPost = computed(() => props.content.blog?.next ?? null)
</script>
