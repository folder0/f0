/**
 * =============================================================================
 * F0 - JSON FEED 1.1 FEED
 * =============================================================================
 *
 * GET /feed.json?path=/blog
 *
 * The same posts as /feed.xml, with full content, as JSON Feed 1.1.
 * See server/utils/feeds.ts.
 */

import { sendFeed } from '../utils/feeds'

export default defineEventHandler(event => sendFeed(event, 'json'))
