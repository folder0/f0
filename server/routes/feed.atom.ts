/**
 * =============================================================================
 * F0 - ATOM 1.0 FEED
 * =============================================================================
 *
 * GET /feed.atom?path=/blog
 *
 * The same posts as /feed.xml, with full content, as Atom 1.0.
 * See server/utils/feeds.ts.
 */

import { sendFeed } from '../utils/feeds'

export default defineEventHandler(event => sendFeed(event, 'atom'))
