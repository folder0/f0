<!--
  F0 - BLOG INDEX
  Post listing with header, cards, tag filtering, pagination.
-->

<template>
  <div class="blog-layout">
    <!-- Loading -->
    <div v-if="pending" class="loading">
      <div class="loading-spinner" />
    </div>

    <!-- Content -->
    <div v-else-if="data">
      <!-- Blog Header -->
      <header class="blog-header">
        <h1>{{ data.config.title || 'Blog' }}</h1>
        <p v-if="data.config.description">{{ data.config.description }}</p>

        <!-- Active tag filter -->
        <div v-if="activeTag" class="blog-tag-filter">
          <span class="blog-tag-filter-label">Filtered by</span>
          <span class="blog-active-tag tag-pill" :class="tagColorClass(activeTag)">
            {{ activeTag }}
            <button class="blog-active-tag-clear" @click="clearTag" aria-label="Clear filter">&times;</button>
          </span>
        </div>
      </header>

      <!-- Empty state -->
      <div v-if="data.posts.length === 0" class="blog-empty">
        <h2>No posts found</h2>
        <p v-if="activeTag">No posts tagged "{{ activeTag }}". <NuxtLink :to="blogPath">View all posts</NuxtLink></p>
        <p v-else>No blog posts yet. Add markdown files to get started.</p>
      </div>

      <!-- Post List -->
      <div v-else class="blog-post-grid">
        <BlogPostCard
          v-for="post in data.posts"
          :key="post.path"
          :post="post"
          :basePath="blogPath"
          :dateFormat="data.config.dateFormat"
        />
      </div>

      <!-- Pagination -->
      <BlogPagination
        v-if="data.pagination.totalPages > 1"
        :currentPage="data.pagination.currentPage"
        :totalPages="data.pagination.totalPages"
        @page-change="goToPage"
      />
    </div>

    <!-- Error -->
    <div v-else class="blog-empty">
      <h2>Error loading blog</h2>
      <p>Something went wrong. Please try again.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  path?: string
}>()

const route = useRoute()
const router = useRouter()

const blogPath = computed(() => props.path || '/blog')
const apiPath = computed(() => blogPath.value.replace(/^\//, ''))
const activeTag = computed(() => (route.query.tag as string) || '')
const currentPage = computed(() => parseInt(route.query.page as string) || 1)

const { data, pending } = await useFetch<{
  config: {
    layout: string
    title: string
    description: string
    postsPerPage: number
    dateFormat: 'long' | 'short' | 'relative'
  }
  posts: Array<{
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
  }>
  pagination: {
    currentPage: number
    totalPages: number
    totalPosts: number
    postsPerPage: number
  }
  tags: Array<{ name: string; count: number }>
}>('/api/blog', {
  query: {
    path: apiPath,
    page: currentPage,
    tag: activeTag,
  },
  watch: [apiPath, currentPage, activeTag],
})

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash = hash & hash
  }
  return `tag-color-${Math.abs(hash) % 10}`
}

function goToPage(page: number) {
  const query: Record<string, string> = { page: String(page) }
  if (activeTag.value) query.tag = activeTag.value
  router.push({ path: blogPath.value, query })
}

function clearTag() {
  router.push({ path: blogPath.value })
}

useSeo({
  title: data.value?.config.title || 'Blog',
  description: data.value?.config.description,
})
</script>

<style scoped>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border-primary);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
