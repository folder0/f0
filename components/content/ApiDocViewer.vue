<!--
  =============================================================================
  F0 - API DOCUMENTATION VIEWER
  =============================================================================
  
  Renders OpenAPI and Postman specifications in a clean, readable format.
  
  Features:
  - Endpoint groups/tags with descriptions
  - Method badges (GET, POST, etc.)
  - Parameters table
  - Request/response schemas
  - Download spec button
  
  MVP Strategy (from PRD):
  - NO "Try it Now" console (avoids CORS/proxy complexity)
  - Prominent download button for spec file
-->

<template>
  <div class="api-doc">
    <!-- Header -->
    <header class="api-header">
      <h1>{{ spec.title }}</h1>
      <p v-if="spec.description" class="api-description">{{ spec.description }}</p>
      
      <div class="api-meta">
        <span class="api-version">Version {{ spec.version }}</span>
        <span v-if="spec.baseUrl" class="api-base-url">
          Base URL: <code>{{ spec.baseUrl }}</code>
        </span>
      </div>
      
      <!-- Download button -->
      <button @click="downloadSpec" class="btn btn-secondary download-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download {{ spec.format === 'openapi' ? 'OpenAPI Spec' : 'Postman Collection' }}
      </button>
    </header>
    
    <!-- Authentication section -->
    <section v-if="spec.securitySchemes.length > 0" class="api-section">
      <h2>Authentication</h2>
      <div class="security-schemes">
        <div v-for="scheme in spec.securitySchemes" :key="scheme.name" class="security-scheme">
          <h3>{{ scheme.name }}</h3>
          <p><strong>Type:</strong> {{ formatSecurityType(scheme) }}</p>
          <p v-if="scheme.description">{{ scheme.description }}</p>
        </div>
      </div>
    </section>
    
    <!-- Endpoints by group -->
    <section v-for="group in spec.groups" :key="group.name" class="api-section">
      <h2>{{ group.name }}</h2>
      <p v-if="group.description" class="group-description">{{ group.description }}</p>
      
      <div class="endpoints">
        <div 
          v-for="endpoint in group.endpoints" 
          :key="`${endpoint.method}-${endpoint.path}`"
          class="endpoint"
          :class="{ deprecated: endpoint.deprecated }"
        >
          <!-- Endpoint header -->
          <div class="endpoint-header">
            <span :class="['api-method', `api-method-${endpoint.method}`]">
              {{ endpoint.method.toUpperCase() }}
            </span>
            <code class="api-path">{{ endpoint.path }}</code>
            <span v-if="endpoint.deprecated" class="deprecated-badge">Deprecated</span>
          </div>
          
          <!-- Summary -->
          <p v-if="endpoint.summary" class="endpoint-summary">{{ endpoint.summary }}</p>
          <p v-if="endpoint.description" class="endpoint-description">{{ endpoint.description }}</p>
          
          <!-- Parameters -->
          <div v-if="endpoint.parameters.length > 0" class="endpoint-params">
            <h4>Parameters</h4>
            <table class="api-param-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Location</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="param in endpoint.parameters" :key="param.name">
                  <td>
                    <code>{{ param.name }}</code>
                    <span v-if="param.required" class="param-required">*</span>
                  </td>
                  <td>{{ param.location }}</td>
                  <td><code>{{ param.type }}{{ param.format ? ` (${param.format})` : '' }}</code></td>
                  <td>{{ param.description || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <!-- Request Body -->
          <div v-if="endpoint.requestBody" class="endpoint-body">
            <h4>Request Body</h4>
            <p><strong>Content-Type:</strong> <code>{{ endpoint.requestBody.contentType }}</code></p>
            <p v-if="endpoint.requestBody.description">{{ endpoint.requestBody.description }}</p>
            <div v-if="endpoint.requestBody.example" class="code-example">
              <pre><code>{{ formatJson(endpoint.requestBody.example) }}</code></pre>
            </div>
          </div>
          
          <!-- Responses -->
          <div v-if="endpoint.responses.length > 0" class="endpoint-responses">
            <h4>Responses</h4>
            <div v-for="response in endpoint.responses" :key="response.statusCode" class="response">
              <div class="response-header">
                <span :class="['status-code', getStatusClass(response.statusCode)]">
                  {{ response.statusCode }}
                </span>
                <span class="response-description">{{ response.description }}</span>
              </div>
              <div v-if="response.example" class="code-example">
                <pre><code>{{ formatJson(response.example) }}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { ApiSpec, ApiSecurityScheme } from '~/server/utils/openapi-parser'

// ---------------------------------------------------------------------------
// PROPS
// ---------------------------------------------------------------------------

const props = defineProps<{
  spec: ApiSpec
}>()

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/**
 * Format security scheme type for display
 */
function formatSecurityType(scheme: ApiSecurityScheme): string {
  switch (scheme.type) {
    case 'apiKey':
      return `API Key (in ${scheme.location || 'header'})`
    case 'http':
      return `HTTP ${scheme.scheme || 'bearer'}`
    case 'oauth2':
      return 'OAuth 2.0'
    case 'openIdConnect':
      return 'OpenID Connect'
    default:
      return scheme.type
  }
}

/**
 * Format JSON for display
 */
function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    // Try to parse and re-stringify for formatting
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

/**
 * Get CSS class for status code
 */
function getStatusClass(statusCode: string): string {
  const code = parseInt(statusCode)
  if (code >= 200 && code < 300) return 'status-success'
  if (code >= 300 && code < 400) return 'status-redirect'
  if (code >= 400 && code < 500) return 'status-client-error'
  if (code >= 500) return 'status-server-error'
  return ''
}

/**
 * Download the raw spec file
 */
function downloadSpec() {
  const blob = new Blob([props.spec.rawSpec], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = props.spec.format === 'openapi' ? 'openapi.json' : 'collection.json'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.api-doc {
  max-width: var(--content-max-width);
}

.api-header {
  margin-bottom: var(--spacing-8);
  padding-bottom: var(--spacing-6);
  border-bottom: 1px solid var(--color-border-primary);
}

.api-header h1 {
  margin-bottom: var(--spacing-3);
}

.api-description {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

.api-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

.api-base-url code {
  color: var(--color-text-primary);
}

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-2);
}

.api-section {
  margin-bottom: var(--spacing-10);
}

.api-section h2 {
  margin-bottom: var(--spacing-4);
}

.group-description {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-6);
}

.security-scheme {
  background-color: var(--color-bg-secondary);
  padding: var(--spacing-4);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-4);
}

.security-scheme h3 {
  margin: 0 0 var(--spacing-2);
  font-size: var(--font-size-base);
}

.security-scheme p {
  margin: 0 0 var(--spacing-1);
  font-size: var(--font-size-sm);
}

.endpoints {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-6);
}

.endpoint {
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-lg);
  padding: var(--spacing-5);
}

.endpoint.deprecated {
  opacity: 0.7;
}

.endpoint-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-3);
  flex-wrap: wrap;
}

.api-method {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: 700;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  color: white;
  min-width: 60px;
}

.api-method-get { background-color: #059669; }
.api-method-post { background-color: #2563eb; }
.api-method-put { background-color: #d97706; }
.api-method-patch { background-color: #7c3aed; }
.api-method-delete { background-color: #dc2626; }
.api-method-options { background-color: #6b7280; }
.api-method-head { background-color: #6b7280; }

.api-path {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.deprecated-badge {
  font-size: var(--font-size-xs);
  color: var(--color-warning);
  background-color: var(--color-warning-bg);
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--radius-sm);
}

.endpoint-summary {
  font-weight: 500;
  margin-bottom: var(--spacing-2);
}

.endpoint-description {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-4);
}

.endpoint-params,
.endpoint-body,
.endpoint-responses {
  margin-top: var(--spacing-4);
}

.endpoint-params h4,
.endpoint-body h4,
.endpoint-responses h4 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  margin-bottom: var(--spacing-3);
  color: var(--color-text-secondary);
}

.api-param-table {
  font-size: var(--font-size-sm);
}

.api-param-table th {
  font-weight: 500;
}

.param-required {
  color: var(--color-error);
  margin-left: var(--spacing-1);
}

.code-example {
  margin-top: var(--spacing-3);
}

.code-example pre {
  font-size: var(--font-size-xs);
  max-height: 300px;
  overflow: auto;
}

.response {
  margin-bottom: var(--spacing-4);
}

.response-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-2);
}

.status-code {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  font-weight: 600;
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--radius-sm);
}

.status-success {
  background-color: var(--color-success-bg);
  color: var(--color-success);
}

.status-redirect {
  background-color: var(--color-info-bg);
  color: var(--color-info);
}

.status-client-error {
  background-color: var(--color-warning-bg);
  color: var(--color-warning);
}

.status-server-error {
  background-color: var(--color-error-bg);
  color: var(--color-error);
}

.response-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
</style>
