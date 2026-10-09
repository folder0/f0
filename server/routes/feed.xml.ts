/**
 * =============================================================================
 * F0 - RSS/ATOM FEED ROUTE
 * =============================================================================
 * 
 * GET /feed.xml
 * GET /feed.xml?path=/blog
 * 
 * Generates an RSS 2.0 feed for blog sections.
 * Uses the same post-scanning logic as the blog index API.
 */

import { sendFeed } from '../utils/feeds'

export default defineEventHandler(event => sendFeed(event, 'rss'))
