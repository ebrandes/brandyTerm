// Tiny stdio MCP server for tests: `echo` returns its text; `crash` dies with a message on stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server({ name: 'echo', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    { name: 'crash', description: 'Exit with an error', inputSchema: { type: 'object' } },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'crash') {
    process.stderr.write('fatal: kaboom\n', () => process.exit(1))
    return new Promise(() => {})
  }
  const text = String((req.params.arguments as { text?: unknown } | undefined)?.text ?? '')
  return { content: [{ type: 'text', text }] }
})

await server.connect(new StdioServerTransport())
