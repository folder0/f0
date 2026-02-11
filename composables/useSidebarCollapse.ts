/**
 * =============================================================================
 * F0 - SIDEBAR COLLAPSE COMPOSABLE
 * =============================================================================
 * 
 * Shared state for collapsing the sidebar in blog reading mode.
 * When collapsed, the sidebar hides and content area expands for
 * a distraction-free reading experience.
 */

export function useSidebarCollapse() {
  const isCollapsed = useState<boolean>('sidebar-collapsed', () => false)

  function toggle() {
    isCollapsed.value = !isCollapsed.value
  }

  function collapse() {
    isCollapsed.value = true
  }

  function expand() {
    isCollapsed.value = false
  }

  return {
    isCollapsed: computed(() => isCollapsed.value),
    toggle,
    collapse,
    expand,
  }
}
