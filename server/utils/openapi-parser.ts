/**
 * =============================================================================
 * F0 - OPENAPI & POSTMAN PARSER
 * =============================================================================
 * 
 * This module parses API specification files (OpenAPI/Swagger and Postman)
 * and converts them to a unified format for rendering.
 * 
 * SUPPORTED FORMATS:
 * - OpenAPI 3.x (application/vnd.oai.openapi+json)
 * - Swagger 2.0 (application/vnd.swagger+json)
 * - Postman Collection v2.x (application/vnd.postman.collection+json)
 * 
 * MVP STRATEGY (from PRD):
 * - Display endpoints, parameters, and schema definitions clearly
 * - NO "Try it Now" console (avoids CORS/Proxy complexity)
 * - Prominent "Download Collection" / "Download Spec" button
 * 
 * OUTPUT:
 * The parser produces a normalized ApiSpec object that the frontend
 * can render consistently regardless of source format.
 */

import { readFile } from 'fs/promises'

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format a name for display by converting underscores to spaces
 * and applying title case formatting
 * 
 * Examples:
 * - "Transactions_monitoring" → "Transactions monitoring"
 * - "user_authentication" → "User authentication"
 */
function formatDisplayName(name: string): string {
  if (!name) return name
  
  // Replace underscores with spaces
  let formatted = name.replace(/_/g, ' ')
  
  // Capitalize first letter if it's lowercase
  if (formatted[0] && formatted[0] === formatted[0].toLowerCase()) {
    formatted = formatted[0].toUpperCase() + formatted.slice(1)
  }
  
  return formatted
}

// =============================================================================
// MARKDOWN TO HTML CONVERTER (for descriptions)
// =============================================================================

/**
 * Convert markdown text to HTML for API descriptions
 * Handles common patterns: headers, bold, italic, code, links, tables, lists
 */
function markdownToHtml(text: string | undefined): string | undefined {
  if (!text) return undefined
  
  let html = text
  
  // First, extract and protect code blocks (``` ... ```)
  // Use placeholders without underscores to avoid markdown transformation
  const codeBlocks: string[] = []
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const index = codeBlocks.length
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    codeBlocks.push(`<pre><code class="language-${lang || 'text'}">${escapedCode.trim()}</code></pre>`)
    return `%%CODEBLOCK${index}%%`
  })
  
  // Extract and protect inline code (` ... `)
  const inlineCode: string[] = []
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    const index = inlineCode.length
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    inlineCode.push(`<code>${escapedCode}</code>`)
    return `%%INLINECODE${index}%%`
  })
  
  // Now escape remaining HTML special characters
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  // Convert markdown tables to HTML tables
  html = convertTables(html)
  
  // Convert headers (## Header)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  
  // Convert bold (**text** or __text__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  
  // Convert italic (*text* or _text_) - be careful not to match already converted bold
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>')
  
  // Convert links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  
  // Convert unordered lists (- item)
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  
  // Convert numbered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  
  // Convert line breaks to paragraphs
  // Split by double newlines for paragraphs
  const paragraphs = html.split(/\n\n+/)
  html = paragraphs
    .map(p => {
      p = p.trim()
      // Don't wrap if it's already a block element or a placeholder
      if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<ol') || 
          p.startsWith('<table') || p.startsWith('<li') || p.startsWith('%%CODEBLOCK')) {
        return p
      }
      // Don't wrap empty paragraphs
      if (!p) return ''
      return `<p>${p.replace(/\n/g, '<br>')}</p>`
    })
    .filter(p => p)
    .join('\n')
  
  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`%%CODEBLOCK${i}%%`, block)
  })
  
  // Restore inline code
  inlineCode.forEach((code, i) => {
    html = html.replace(`%%INLINECODE${i}%%`, code)
  })
  
  return html
}

/**
 * Convert markdown tables to HTML tables
 */
function convertTables(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let inTable = false
  let tableRows: string[] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Check if this is a table row (contains | and isn't a separator)
    const isTableRow = line.includes('|') && !line.match(/^\|?\s*[-:]+\s*\|/)
    const isSeparator = line.match(/^\|?\s*[-:]+[-|\s:]+\|?\s*$/)
    
    if (isTableRow) {
      if (!inTable) {
        inTable = true
        tableRows = []
      }
      tableRows.push(line)
    } else if (isSeparator && inTable) {
      // Skip separator lines
      continue
    } else {
      // End of table or not a table
      if (inTable && tableRows.length > 0) {
        result.push(renderTable(tableRows))
        tableRows = []
        inTable = false
      }
      result.push(line)
    }
  }
  
  // Handle table at end of text
  if (inTable && tableRows.length > 0) {
    result.push(renderTable(tableRows))
  }
  
  return result.join('\n')
}

/**
 * Render table rows as HTML table
 */
function renderTable(rows: string[]): string {
  if (rows.length === 0) return ''
  
  const parseRow = (row: string): string[] => {
    return row
      .split('|')
      .map(cell => cell.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length - 1 || arr.length <= 2)
  }
  
  const headerCells = parseRow(rows[0])
  const bodyRows = rows.slice(1)
  
  let html = '<table class="api-table"><thead><tr>'
  for (const cell of headerCells) {
    html += `<th>${cell}</th>`
  }
  html += '</tr></thead><tbody>'
  
  for (const row of bodyRows) {
    const cells = parseRow(row)
    html += '<tr>'
    for (const cell of cells) {
      html += `<td>${cell}</td>`
    }
    html += '</tr>'
  }
  
  html += '</tbody></table>'
  return html
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * HTTP methods supported
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options' | 'head'

/**
 * API parameter location
 */
export type ParameterLocation = 'path' | 'query' | 'header' | 'body' | 'formData'

/**
 * Parameter definition
 */
export interface ApiParameter {
  name: string
  location: ParameterLocation
  description?: string
  required: boolean
  type: string
  format?: string
  example?: unknown
  schema?: ApiSchema
}

/**
 * Schema definition (simplified)
 */
export interface ApiSchema {
  type: string
  format?: string
  description?: string
  properties?: Record<string, ApiSchema>
  items?: ApiSchema
  required?: string[]
  example?: unknown
  enum?: string[]
}

/**
 * Request body definition
 */
export interface ApiRequestBody {
  description?: string
  required: boolean
  contentType: string
  schema?: ApiSchema
  example?: unknown
}

/**
 * Response definition
 */
export interface ApiResponse {
  statusCode: string
  description: string
  contentType?: string
  schema?: ApiSchema
  example?: unknown
}

/**
 * Single API endpoint
 */
export interface ApiEndpoint {
  method: HttpMethod
  path: string
  summary?: string
  description?: string
  tags: string[]
  parameters: ApiParameter[]
  requestBody?: ApiRequestBody
  responses: ApiResponse[]
  deprecated: boolean
  security?: string[]
}

/**
 * API endpoint grouped by tag/folder
 */
export interface ApiEndpointGroup {
  name: string
  description?: string
  endpoints: ApiEndpoint[]
}

/**
 * Security scheme definition
 */
export interface ApiSecurityScheme {
  name: string
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'
  description?: string
  location?: 'header' | 'query' | 'cookie'
  scheme?: string  // For http type (e.g., 'bearer')
}

/**
 * Complete API specification (normalized)
 */
export interface ApiSpec {
  title: string
  description?: string
  version: string
  baseUrl?: string
  format: 'openapi' | 'postman'
  groups: ApiEndpointGroup[]
  securitySchemes: ApiSecurityScheme[]
  // Raw spec for download
  rawSpec: string
}

// =============================================================================
// DETECTION
// =============================================================================

/**
 * Detect the type of API spec from JSON content
 */
export function detectSpecType(json: unknown): 'openapi' | 'postman' | null {
  if (typeof json !== 'object' || json === null) return null
  
  const obj = json as Record<string, unknown>
  
  // OpenAPI 3.x
  if (typeof obj.openapi === 'string' && obj.openapi.startsWith('3.')) {
    return 'openapi'
  }
  
  // Swagger 2.0
  if (typeof obj.swagger === 'string' && obj.swagger.startsWith('2.')) {
    return 'openapi'
  }
  
  // Postman Collection
  if (obj.info && typeof obj.info === 'object') {
    const info = obj.info as Record<string, unknown>
    if (typeof info.schema === 'string' && info.schema.includes('schema.getpostman.com')) {
      return 'postman'
    }
  }
  
  return null
}

// =============================================================================
// OPENAPI PARSER
// =============================================================================

/**
 * Parse OpenAPI/Swagger spec to normalized format
 */
function parseOpenApi(spec: Record<string, unknown>, rawSpec: string): ApiSpec {
  const info = spec.info as Record<string, unknown> || {}
  const isV3 = typeof spec.openapi === 'string'
  
  // Extract base URL
  let baseUrl: string | undefined
  if (isV3 && Array.isArray(spec.servers) && spec.servers.length > 0) {
    baseUrl = (spec.servers[0] as Record<string, unknown>).url as string
  } else if (!isV3 && spec.host) {
    const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : 'https'
    const basePath = spec.basePath || ''
    baseUrl = `${scheme}://${spec.host}${basePath}`
  }
  
  // Parse security schemes
  const securitySchemes: ApiSecurityScheme[] = []
  const secDefs = isV3 
    ? (spec.components as Record<string, unknown>)?.securitySchemes
    : spec.securityDefinitions
    
  if (secDefs && typeof secDefs === 'object') {
    for (const [name, scheme] of Object.entries(secDefs as Record<string, Record<string, unknown>>)) {
      securitySchemes.push({
        name,
        type: scheme.type as ApiSecurityScheme['type'],
        description: scheme.description as string | undefined,
        location: scheme.in as ApiSecurityScheme['location'],
        scheme: scheme.scheme as string | undefined,
      })
    }
  }
  
  // Parse paths into endpoints
  const endpoints: ApiEndpoint[] = []
  const paths = spec.paths as Record<string, Record<string, unknown>> || {}
  
  for (const [path, pathItem] of Object.entries(paths)) {
    const methods: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']
    
    for (const method of methods) {
      const operation = pathItem[method] as Record<string, unknown> | undefined
      if (!operation) continue
      
      // Parse parameters
      const parameters: ApiParameter[] = []
      const paramList = [
        ...(pathItem.parameters as unknown[] || []),
        ...(operation.parameters as unknown[] || []),
      ]
      
      for (const param of paramList) {
        const p = param as Record<string, unknown>
        parameters.push({
          name: p.name as string,
          location: p.in as ParameterLocation,
          description: p.description as string | undefined,
          required: p.required as boolean || false,
          type: (p.type as string) || (p.schema as Record<string, unknown>)?.type as string || 'string',
          format: (p.format as string) || (p.schema as Record<string, unknown>)?.format as string | undefined,
          example: p.example,
          schema: p.schema as ApiSchema | undefined,
        })
      }
      
      // Parse request body (OpenAPI 3.x)
      let requestBody: ApiRequestBody | undefined
      if (isV3 && operation.requestBody) {
        const rb = operation.requestBody as Record<string, unknown>
        const content = rb.content as Record<string, Record<string, unknown>> || {}
        const contentType = Object.keys(content)[0] || 'application/json'
        const contentSchema = content[contentType]
        
        requestBody = {
          description: rb.description as string | undefined,
          required: rb.required as boolean || false,
          contentType,
          schema: contentSchema?.schema as ApiSchema | undefined,
          example: contentSchema?.example,
        }
      }
      
      // Parse responses
      const responses: ApiResponse[] = []
      const respDefs = operation.responses as Record<string, Record<string, unknown>> || {}
      
      for (const [statusCode, response] of Object.entries(respDefs)) {
        let contentType: string | undefined
        let schema: ApiSchema | undefined
        let example: unknown
        
        if (isV3 && response.content) {
          const content = response.content as Record<string, Record<string, unknown>>
          contentType = Object.keys(content)[0]
          if (contentType) {
            schema = content[contentType].schema as ApiSchema | undefined
            example = content[contentType].example
          }
        } else if (!isV3) {
          schema = response.schema as ApiSchema | undefined
          example = response.examples
        }
        
        responses.push({
          statusCode,
          description: response.description as string || '',
          contentType,
          schema,
          example,
        })
      }
      
      endpoints.push({
        method,
        path,
        summary: operation.summary as string | undefined,
        description: markdownToHtml(operation.description as string | undefined),
        tags: (operation.tags as string[]) || ['default'],
        parameters,
        requestBody,
        responses,
        deprecated: operation.deprecated as boolean || false,
        security: operation.security as string[] | undefined,
      })
    }
  }
  
  // Group endpoints by tag
  const groupMap = new Map<string, ApiEndpoint[]>()
  
  for (const endpoint of endpoints) {
    const tag = endpoint.tags[0] || 'default'
    if (!groupMap.has(tag)) {
      groupMap.set(tag, [])
    }
    groupMap.get(tag)!.push(endpoint)
  }
  
  // Build groups with descriptions from tags
  const groups: ApiEndpointGroup[] = []
  const tagDefs = spec.tags as Array<Record<string, unknown>> || []
  const tagDescriptions = new Map<string, string>()
  
  for (const tag of tagDefs) {
    tagDescriptions.set(tag.name as string, tag.description as string || '')
  }
  
  for (const [name, eps] of groupMap.entries()) {
    groups.push({
      name: formatDisplayName(name),
      description: markdownToHtml(tagDescriptions.get(name)),
      endpoints: eps,
    })
  }
  
  return {
    title: info.title as string || 'API Reference',
    description: markdownToHtml(info.description as string | undefined),
    version: info.version as string || '1.0.0',
    baseUrl,
    format: 'openapi',
    groups,
    securitySchemes,
    rawSpec,
  }
}

// =============================================================================
// POSTMAN PARSER
// =============================================================================

/**
 * Parse Postman collection to normalized format
 */
function parsePostman(collection: Record<string, unknown>, rawSpec: string): ApiSpec {
  const info = collection.info as Record<string, unknown> || {}
  
  // Recursive function to process items (folders and requests)
  function processItems(
    items: unknown[],
    parentPath: string = ''
  ): { groups: ApiEndpointGroup[]; endpoints: ApiEndpoint[] } {
    const groups: ApiEndpointGroup[] = []
    const endpoints: ApiEndpoint[] = []
    
    for (const item of items) {
      const i = item as Record<string, unknown>
      
      // Check if this is a folder (has item array) or a request
      if (Array.isArray(i.item)) {
        // It's a folder - recurse
        const folderName = i.name as string || 'Folder'
        const displayName = formatDisplayName(folderName)
        const { groups: subGroups, endpoints: subEndpoints } = processItems(
          i.item as unknown[],
          parentPath ? `${parentPath}/${folderName}` : folderName
        )
        
        // Add folder as a group with its endpoints
        if (subEndpoints.length > 0) {
          groups.push({
            name: displayName,
            description: markdownToHtml(i.description as string | undefined),
            endpoints: subEndpoints,
          })
        }
        
        // Add any nested groups
        groups.push(...subGroups)
      } else if (i.request) {
        // It's a request
        const request = i.request as Record<string, unknown>
        
        // Parse URL
        let path = '/'
        let baseUrl: string | undefined
        
        if (typeof request.url === 'string') {
          path = request.url
        } else if (request.url && typeof request.url === 'object') {
          const urlObj = request.url as Record<string, unknown>
          if (urlObj.raw) {
            path = urlObj.raw as string
          } else if (Array.isArray(urlObj.path)) {
            path = '/' + (urlObj.path as string[]).join('/')
          }
        }
        
        // Parse method
        const method = ((typeof request.method === 'string' 
          ? request.method 
          : 'GET'
        ).toLowerCase()) as HttpMethod
        
        // Parse headers as parameters
        const parameters: ApiParameter[] = []
        if (Array.isArray(request.header)) {
          for (const header of request.header as Array<Record<string, unknown>>) {
            parameters.push({
              name: header.key as string || '',
              location: 'header',
              description: header.description as string | undefined,
              required: false,
              type: 'string',
              example: header.value,
            })
          }
        }
        
        // Parse query parameters from URL
        if (request.url && typeof request.url === 'object') {
          const urlObj = request.url as Record<string, unknown>
          if (Array.isArray(urlObj.query)) {
            for (const query of urlObj.query as Array<Record<string, unknown>>) {
              parameters.push({
                name: query.key as string || '',
                location: 'query',
                description: query.description as string | undefined,
                required: false,
                type: 'string',
                example: query.value,
              })
            }
          }
        }
        
        // Parse request body
        let requestBody: ApiRequestBody | undefined
        if (request.body) {
          const body = request.body as Record<string, unknown>
          requestBody = {
            description: undefined,
            required: false,
            contentType: body.mode === 'raw' ? 'application/json' : 'application/x-www-form-urlencoded',
            example: body.raw,
          }
        }
        
        // Parse expected responses
        const responses: ApiResponse[] = []
        if (Array.isArray(i.response)) {
          for (const resp of i.response as Array<Record<string, unknown>>) {
            responses.push({
              statusCode: String(resp.code || 200),
              description: resp.name as string || '',
              contentType: 'application/json',
              example: resp.body,
            })
          }
        }
        
        // If no responses defined, add a default
        if (responses.length === 0) {
          responses.push({
            statusCode: '200',
            description: 'Successful response',
          })
        }
        
        endpoints.push({
          method,
          path,
          summary: i.name as string || undefined,
          description: markdownToHtml(
            (i.description as string | undefined) || 
            (request.description as string | undefined)
          ),
          tags: [parentPath || 'default'],
          parameters,
          requestBody,
          responses,
          deprecated: false,
        })
      }
    }
    
    return { groups, endpoints }
  }
  
  // Process all items
  const items = collection.item as unknown[] || []
  const { groups, endpoints } = processItems(items)
  
  // If there are ungrouped endpoints, add them to a default group
  if (endpoints.length > 0) {
    groups.unshift({
      name: 'Requests',
      endpoints,
    })
  }
  
  return {
    title: info.name as string || 'API Collection',
    description: markdownToHtml(info.description as string | undefined),
    version: info.version as string || '1.0.0',
    format: 'postman',
    groups,
    securitySchemes: [],
    rawSpec,
  }
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse an API specification file (OpenAPI or Postman)
 * 
 * @param filePath - Path to the JSON file
 * @returns Normalized ApiSpec object
 * @throws Error if file cannot be parsed
 */
export async function parseApiSpec(filePath: string): Promise<ApiSpec> {
  const rawSpec = await readFile(filePath, 'utf-8')
  
  let json: unknown
  try {
    json = JSON.parse(rawSpec)
  } catch (error) {
    throw new Error(`Failed to parse JSON: ${error}`)
  }
  
  const specType = detectSpecType(json)
  
  if (specType === 'openapi') {
    return parseOpenApi(json as Record<string, unknown>, rawSpec)
  }
  
  if (specType === 'postman') {
    return parsePostman(json as Record<string, unknown>, rawSpec)
  }
  
  throw new Error('Unrecognized API specification format. Expected OpenAPI or Postman Collection.')
}

/**
 * Convert API spec to plain text for LLM output
 * 
 * This produces a structured text representation that preserves
 * all semantic information without any HTML or styling.
 */
export function apiSpecToPlainText(spec: ApiSpec): string {
  const lines: string[] = []
  
  lines.push(`# ${spec.title}`)
  if (spec.description) {
    lines.push('')
    lines.push(spec.description)
  }
  lines.push('')
  lines.push(`Version: ${spec.version}`)
  if (spec.baseUrl) {
    lines.push(`Base URL: ${spec.baseUrl}`)
  }
  lines.push('')
  
  // Security schemes
  if (spec.securitySchemes.length > 0) {
    lines.push('## Authentication')
    lines.push('')
    for (const scheme of spec.securitySchemes) {
      lines.push(`- **${scheme.name}**: ${scheme.type}${scheme.scheme ? ` (${scheme.scheme})` : ''}`)
      if (scheme.description) {
        lines.push(`  ${scheme.description}`)
      }
    }
    lines.push('')
  }
  
  // Endpoints by group
  for (const group of spec.groups) {
    lines.push(`## ${group.name}`)
    if (group.description) {
      lines.push('')
      lines.push(group.description)
    }
    lines.push('')
    
    for (const endpoint of group.endpoints) {
      lines.push(`### ${endpoint.method.toUpperCase()} ${endpoint.path}`)
      if (endpoint.summary) {
        lines.push(`${endpoint.summary}`)
      }
      if (endpoint.description) {
        lines.push('')
        lines.push(endpoint.description)
      }
      lines.push('')
      
      // Parameters
      if (endpoint.parameters.length > 0) {
        lines.push('**Parameters:**')
        for (const param of endpoint.parameters) {
          const required = param.required ? ' (required)' : ''
          lines.push(`- \`${param.name}\` [${param.location}]: ${param.type}${required}`)
          if (param.description) {
            lines.push(`  ${param.description}`)
          }
        }
        lines.push('')
      }
      
      // Request body
      if (endpoint.requestBody) {
        lines.push('**Request Body:**')
        lines.push(`Content-Type: ${endpoint.requestBody.contentType}`)
        if (endpoint.requestBody.description) {
          lines.push(endpoint.requestBody.description)
        }
        lines.push('')
      }
      
      // Responses
      if (endpoint.responses.length > 0) {
        lines.push('**Responses:**')
        for (const response of endpoint.responses) {
          lines.push(`- ${response.statusCode}: ${response.description}`)
        }
        lines.push('')
      }
    }
  }
  
  return lines.join('\n')
}
