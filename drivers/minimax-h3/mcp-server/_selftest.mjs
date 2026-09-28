// 自测：用官方 MCP 客户端 SDK 以 stdio 连上 H3 MCP 服务器，列出工具并调用只读工具
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.join(HERE, 'minimax-h3-mcp.mjs')
const WORKDIR = 'E:/Videos/未来再见翻填'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [SERVER],
  cwd: WORKDIR,
  stderr: 'pipe',
})
transport.stderr?.on('data', (d) => process.stderr.write('[server] ' + String(d).trimEnd() + '\n'))

const client = new Client({ name: 'h3-selftest', version: '1.0.0' })
await client.connect(transport)
console.log('✅ 已连接；协商协议版本 =', client.getProtocolVersion?.() ?? '(n/a)')
console.log('   服务端信息 =', JSON.stringify(client.getServerVersion?.() ?? null))

const tools = await client.listTools({})
console.log(`\n✅ tools/list → ${tools.tools.length} 个工具`)
for (const t of tools.tools) console.log(`   - ${t.name}  ::  ${(t.description || '').slice(0, 70)}...`)

const callText = async (name, args) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r?.content?.find?.((c) => c.type === 'text')?.text ?? JSON.stringify(r)
  return { isError: !!r?.isError, text }
}

console.log('\n=== tools/call: h3_estimate_cost (纯本地，不花钱) ===')
console.log(JSON.stringify(await callText('h3_estimate_cost', { model: 'MiniMax-H3', resolution: '768P', duration: 5 }), null, 2))

console.log('\n=== tools/call: h3_list_tasks (只读) ===')
console.log(JSON.stringify(await callText('h3_list_tasks', { size: 3 }), null, 2))

console.log('\n=== tools/call: h3_task_status (查今天那条已成功任务) ===')
console.log(JSON.stringify(await callText('h3_task_status', { taskId: '446283055206708' }), null, 2))

console.log('\n=== 花钱保护测试：不传 confirmSpend 应被拒绝，且不产生费用 ===')
console.log(JSON.stringify(await callText('h3_generate_video', {
  prompt: 'selftest probe — should be rejected before any charge',
  duration: 15, resolution: '2K', ratio: '16:9',
}), null, 2))

await client.close()
console.log('\n✅ 已关闭连接')
