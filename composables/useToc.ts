/**
 * =============================================================================
 * F0 - TABLE OF CONTENTS COMPOSABLE
 * =============================================================================
 * 
 * Shared state for table of contents across layout and pages.
 * Uses useState for SSR-compatible shared state.
 * 
 * USAGE:
 * ```vue
 * // In layout:
 * const { tocItems, showToc } = useToc()
 * 
 * // In page:
 * const { setTocItems } = useToc()
 * setTocItems(content.toc)
 * ```
 */

import type { TocItem } from '~/server/utils/markdown'

export function useToc() {
  // Shared state using useState (SSR compatible)
  const tocItems = useState<TocItem[]>('toc-items', () => [])
  
  /**
   * Set TOC items (called by pages)
   */
  function setTocItems(items: TocItem[] | undefined) {
    tocItems.value = items || []
  }
  
  /**
   * Clear TOC items
   */
  function clearToc() {
    tocItems.value = []
  }
  
  /**
   * Whether TOC should be shown
   */
  const showToc = computed(() => tocItems.value.length > 0)
  
  return {
    tocItems: readonly(tocItems),
    showToc,
    setTocItems,
    clearToc,
  }
}
