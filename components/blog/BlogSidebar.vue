<!--
  =============================================================================
  F0 - BLOG SIDEBAR COMPONENT
  =============================================================================
  
  Simplified sidebar for blog sections showing:
  - "All Posts" link
  - Recent posts list
  - Tag cloud
  
  USAGE:
  <BlogSidebar :path="'/blog'" />
-->

<template>
  <div class="blog-sidebar">
    <!-- Collapse toggle -->
    <button
      class="blog-sidebar-collapse-btn"
      @click="toggleCollapse"
      :title="isCollapsed ? 'Show sidebar' : 'Hide sidebar for reading mode'"
      :aria-label="isCollapsed ? 'Show sidebar' : 'Hide sidebar'"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="11 17 6 12 11 7" />
        <polyline points="18 17 13 12 18 7" />
      </svg>
      <span class="blog-sidebar-collapse-text">Hide sidebar</span>
    </button>

    <!-- All Posts -->
    <div class="blog-sidebar-section">
      <NuxtLink
        :to="blogPath"
        class="blog-sidebar-all-posts"
        :class="{ active: isIndexActive }"
      >
        All Posts
      </NuxtLink>
    </div>
    
    <!-- Recent Posts -->
    <div v-if="recentPosts.length > 0" class="blog-sidebar-section">
      <h3 class="blog-sidebar-title">Recent Posts</h3>
      <ul class="blog-sidebar-post-list">
        <li v-for="post in recentPosts" :key="post.path" class="blog-sidebar-post-item">
          <NuxtLink
            :to="post.path"
            class="blog-sidebar-post-link"
            :class="{ active: isActive(post.path) }"
          >
            {{ post.title }}
            <span class="blog-sidebar-post-date">{{ formatShortDate(post.date) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>
    
    <!-- Tags -->
    <div v-if="tags.length > 0" class="blog-sidebar-section">
      <h3 class="blog-sidebar-title">Tags</h3>
      <div class="blog-sidebar-tags">
        <NuxtLink
          v-for="tag in tags"
          :key="tag.name"
          :to="`${blogPath}?tag=${encodeURIComponent(tag.name)}`"
          class="tag-pill"
          :class="[tagColorClass(tag.name), { active: activeTag === tag.name }]"
        >
          {{ tag.name }} ({{ tag.count }})
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  path?: string
}>()

const { isCollapsed, toggle: toggleCollapse } = useSidebarCollapse()

const route = useRoute()
const blogPath = computed(() => props.path || '/blog')
const apiPath = computed(() => blogPath.value.replace(/^\//, ''))
const activeTag = computed(() => (route.query.tag as string) || '')

// Check if the current route is the blog index
const isIndexActive = computed(() => {
  return route.path === blogPath.value || route.path === blogPath.value + '/'
})

// Check if a specific post is active
function isActive(path: string): boolean {
  return route.path === path
}

// Fetch recent posts and tags
const { data } = await useFetch<{
  posts: Array<{ title: string; path: string; date: string }>
  tags: Array<{ name: string; count: number }>
}>('/api/blog', {
  query: { path: apiPath },
})

const recentPosts = computed(() => {
  return (data.value?.posts || []).slice(0, 10)
})

const tags = computed(() => {
  return (data.value?.tags || []).slice(0, 15)
})

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash) + tag.charCodeAt(i)
    hash = hash & hash
  }
  return `tag-color-${Math.abs(hash) % 10}`
}

function formatShortDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}
</script>
