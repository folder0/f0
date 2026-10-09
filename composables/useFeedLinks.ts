/**
 * Advertise a blog's feeds (RSS, Atom, JSON Feed) in the page head, so
 * browsers and feed readers can discover them.
 */
export function useFeedLinks(blogPath: MaybeRefOrGetter<string>, title?: MaybeRefOrGetter<string | undefined>) {
  useHead(() => {
    const path = toValue(blogPath)
    const query = path && path !== '/' ? `?path=${encodeURI(path)}` : ''
    const name = toValue(title) || 'Blog'
    return {
      link: [
        { rel: 'alternate', type: 'application/rss+xml', title: `${name} (RSS)`, href: `/feed.xml${query}` },
        { rel: 'alternate', type: 'application/atom+xml', title: `${name} (Atom)`, href: `/feed.atom${query}` },
        { rel: 'alternate', type: 'application/feed+json', title: `${name} (JSON Feed)`, href: `/feed.json${query}` },
      ],
    }
  })
}
