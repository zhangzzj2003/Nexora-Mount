import { z } from 'zod'

// 分开定义两种地址，禁止把 SMB 共享名与 WebDAV 路径错误拼接。
const base = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(64),
  username: z
    .string()
    .max(256)
    .regex(/^[^\u0000-\u001f]*$/)
    .default(''),
  autoConnect: z.boolean().default(false),
  drive: z
    .string()
    .regex(/^[D-Z]:$/)
    .optional()
}
export const connectionSchema = z.discriminatedUnion('protocol', [
  z.object({
    ...base,
    protocol: z.literal('smb'),
    host: z.string().trim().min(1).max(253),
    share: z.string().trim().min(1).max(255)
  }),
  z.object({ ...base, protocol: z.literal('webdav'), url: z.string().url().max(2048) })
])
export type Connection = z.infer<typeof connectionSchema>
export const settingsSchema = z.object({
  login: z.boolean(),
  closeToTray: z.boolean(),
  reconnect: z.boolean()
})
export type Settings = z.infer<typeof settingsSchema>
export type ErrorCode =
  | 'INVALID'
  | 'AUTH'
  | 'CERTIFICATE'
  | 'NETWORK'
  | 'BUSY'
  | 'CONFLICT'
  | 'DEPENDENCY'
  | 'TIMEOUT'
  | 'SYSTEM'
  | 'READ_ONLY'
export interface Failure {
  code: ErrorCode
  message: string
  detail?: string
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure }
export interface MountInfo {
  remote: string
  local: string
  protocol: 'smb' | 'webdav'
  readOnly: boolean
}
export interface Probe {
  available: boolean
  reachable: boolean
  warnings: string[]
  maxFileBytes?: number
}
export interface MountState {
  status:
    | 'disconnected'
    | 'checking'
    | 'connecting'
    | 'mounted'
    | 'disconnecting'
    | 'retrying'
    | 'error'
  local?: string
  readOnly?: boolean
  error?: Failure
  checkedAt?: number
  retryAt?: number
}
export interface ConnectionView {
  config: Connection
  hasPassword: boolean
  state: MountState
}
export interface Snapshot {
  connections: ConnectionView[]
  settings: Settings
  platform: string
  version: string
}
export interface Diagnostic {
  time: string
  action: string
  connectionId?: string
  code?: ErrorCode
}
export interface Backend {
  snapshot(): Promise<Snapshot>
  save(input: Connection, password?: string): Promise<void>
  remove(id: string): Promise<void>
  mount(id: string): Promise<void>
  unmount(id: string): Promise<void>
  probe(id: string): Promise<Probe>
  open(id: string): Promise<void>
  refresh(): Promise<void>
  settings(input: Settings): Promise<void>
  diagnostics(): Promise<string>
  exportDiagnostics(content: string): Promise<boolean>
  onChange(callback: (snapshot: Snapshot) => void): () => void
}
declare global {
  interface Window {
    nexora: Backend
  }
}
export const DEFAULT_SETTINGS: Settings = { login: false, closeToTray: true, reconnect: true }
