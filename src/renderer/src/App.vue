<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import {
  ArrowDownToLine,
  ArrowRight,
  Cable,
  Check,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FileText,
  FolderOpen,
  HardDrive,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Unplug,
  X
} from '@lucide/vue'
import type { Connection, ConnectionView, Probe, Settings } from '../../shared/types'
import { useConnections } from './store'

const store = useConnections()
// 显式绑定白名单接口，使模板只访问这组受限业务方法。
const window = globalThis.window
const page = ref<'connections' | 'settings' | 'diagnostics'>('connections')
const filter = ref('')
const selected = ref('')
const modal = ref(false)
const formElement = ref<HTMLFormElement>()
const previousFocus = ref<HTMLElement>()
const editing = ref(false)
const confirmedRemoval = ref(false)
const probe = ref<Probe>()
const diagnostic = ref('')
const form = reactive({
  id: '',
  name: '',
  protocol: 'smb' as 'smb' | 'webdav',
  host: '',
  share: '',
  url: 'https://',
  username: '',
  password: '',
  autoConnect: false,
  drive: '',
  clearPassword: false
})
const visible = computed(() =>
  store.snapshot.connections.filter((x) =>
    `${x.config.name} ${address(x.config)}`.toLowerCase().includes(filter.value.toLowerCase())
  )
)
const active = computed(
  () => store.snapshot.connections.find((x) => x.config.id === selected.value) ?? visible.value[0]
)
const mounted = computed(
  () => store.snapshot.connections.filter((x) => x.state.status === 'mounted').length
)
const labels: Record<string, string> = {
  disconnected: '未连接',
  checking: '检查中',
  connecting: '正在连接',
  mounted: '已挂载',
  disconnecting: '正在卸载',
  retrying: '等待重连',
  error: '需要处理'
}
function address(c: Connection) {
  return c.protocol === 'smb' ? `smb://${c.host}/${c.share}` : c.url
}
function isBusy(row?: ConnectionView) {
  return row && ['checking', 'connecting', 'disconnecting'].includes(row.state.status)
}
async function edit(row?: ConnectionView) {
  previousFocus.value = document.activeElement as HTMLElement
  const c = row?.config
  editing.value = Boolean(c)
  Object.assign(form, {
    id: c?.id ?? crypto.randomUUID(),
    name: c?.name ?? '',
    protocol: c?.protocol ?? 'smb',
    host: c?.protocol === 'smb' ? c.host : '',
    share: c?.protocol === 'smb' ? c.share : '',
    url: c?.protocol === 'webdav' ? c.url : 'https://',
    username: c?.username ?? '',
    password: '',
    autoConnect: c?.autoConnect ?? false,
    drive: c?.drive ?? '',
    clearPassword: false
  })
  modal.value = true
  await nextTick()
  formElement.value?.querySelector('input')?.focus()
}
function close() {
  modal.value = false
  form.password = ''
  previousFocus.value?.focus()
}
async function save() {
  const base = {
    id: form.id,
    name: form.name,
    username: form.username,
    autoConnect: form.autoConnect,
    ...(form.drive ? { drive: form.drive } : {})
  }
  const input =
    form.protocol === 'smb'
      ? { ...base, protocol: 'smb' as const, host: form.host, share: form.share }
      : { ...base, protocol: 'webdav' as const, url: form.url }
  // 编辑时密码留空表示保留原值；“清除密码”是独立、明确的动作。
  const password = form.clearPassword ? '' : form.password || undefined
  if (await store.run(() => window.nexora.save(input, password), '连接配置已保存。')) {
    selected.value = form.id
    probe.value = undefined
    close()
  }
}
async function test() {
  if (active.value)
    await store.run(async () => {
      probe.value = await window.nexora.probe(active.value!.config.id)
    }, '连接测试已完成；目录权限请在挂载后验证。')
}
async function remove() {
  if (!active.value) return
  if (await store.run(() => window.nexora.remove(active.value!.config.id), '连接已删除。')) {
    confirmedRemoval.value = false
    probe.value = undefined
  }
}
async function settings(key: keyof Settings, event: Event) {
  const value = (event.target as HTMLInputElement).checked
  const ok = await store.run(
    () => window.nexora.settings({ ...store.snapshot.settings, [key]: value }),
    '设置已保存。'
  )
  if (!ok) (event.target as HTMLInputElement).checked = store.snapshot.settings[key]
}
async function diagnostics() {
  page.value = 'diagnostics'
  await store.run(async () => {
    diagnostic.value = await window.nexora.diagnostics()
  })
}
function select(row: ConnectionView) {
  selected.value = row.config.id
  probe.value = undefined
  confirmedRemoval.value = false
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape' && !store.busy) close()
  // 模态框内部循环键盘焦点，避免 Tab 进入被遮挡的主界面。
  if (event.key === 'Tab') {
    const items = Array.from(
      formElement.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select'
      ) ?? []
    )
    const first = items[0],
      last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
onMounted(() => {
  void store.initialize()
})
</script>

<template>
  <div class="desktop">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"><Cable :size="23" /></span>
        <div>NEXORA<span>Mount</span></div>
      </div>
      <p class="nav-caption">工作空间</p>
      <nav aria-label="主导航">
        <button :class="{ selected: page === 'connections' }" @click="page = 'connections'">
          <HardDrive :size="18" />我的连接<span class="nav-count">{{
            store.snapshot.connections.length
          }}</span>
        </button>
        <button :class="{ selected: page === 'settings' }" @click="page = 'settings'">
          <Settings2 :size="18" />偏好设置
        </button>
        <button :class="{ selected: page === 'diagnostics' }" @click="diagnostics">
          <FileText :size="18" />连接诊断
        </button>
      </nav>
      <div class="sidebar-note">
        <ShieldCheck :size="20" /><strong>文件始终在 NAS</strong>
        <p>通过系统挂载直接访问，<br />延续熟悉的项目工作方式。</p>
      </div>
      <div class="sidebar-bottom">
        <span class="dot online"></span>本机连接管理<span
          >v{{ store.snapshot.version || '0.1.0' }}</span
        >
      </div>
    </aside>

    <main>
      <header class="topbar">
        <span
          >Nexora Mount <ChevronRight :size="13" />{{
            page === 'connections' ? '我的连接' : page === 'settings' ? '偏好设置' : '连接诊断'
          }}</span
        ><span class="platform">{{
          store.snapshot.platform === 'darwin'
            ? 'macOS'
            : store.snapshot.platform === 'win32'
              ? 'Windows'
              : '正在初始化'
        }}</span>
      </header>
      <div v-if="store.message" role="status" class="notice" :class="{ danger: store.error }">
        <CircleHelp v-if="store.error" :size="17" /><Check v-else :size="17" />{{ store.message
        }}<button aria-label="关闭提示" @click="store.message = ''"><X :size="15" /></button>
      </div>

      <section v-if="page === 'connections'" class="workspace">
        <div class="page-heading">
          <div>
            <p class="eyebrow">YOUR REMOTE WORKSPACE</p>
            <h1>让工作，连接起来。</h1>
            <p class="subtitle">挂载远程目录，在熟悉的工具里继续你的项目。</p>
          </div>
          <button class="primary" @click="edit()"><Plus :size="17" />添加连接</button>
        </div>
        <div class="summary">
          <div>
            <span class="dot online"></span><strong>{{ mounted }}</strong
            >已挂载
          </div>
          <div>
            <strong>{{ store.snapshot.connections.length }}</strong
            >个远程目录
          </div>
          <span class="summary-note">SMB / WebDAV · 系统原生挂载</span>
        </div>
        <div class="connection-layout">
          <section class="connections-panel" aria-label="连接列表">
            <div class="list-heading">
              <h2>所有连接</h2>
              <button
                class="icon-button"
                aria-label="刷新连接状态"
                :disabled="store.busy"
                @click="store.run(() => window.nexora.refresh(), '连接状态已刷新。')"
              >
                <RefreshCw :size="16" :class="{ spinning: store.busy }" />
              </button>
            </div>
            <label class="search"
              ><Search :size="16" /><input
                v-model="filter"
                placeholder="搜索名称或地址"
                aria-label="搜索连接"
            /></label>
            <div v-if="!visible.length" class="empty-list">
              <HardDrive :size="30" /><strong>{{
                filter ? '没有匹配的连接' : '还没有远程目录'
              }}</strong>
              <p>{{ filter ? '试试其他名称或地址。' : '添加 NAS 地址，连接你的工作文件。' }}</p>
              <button v-if="!filter" class="text-button" @click="edit()">
                添加第一个连接 <ArrowRight :size="14" />
              </button>
            </div>
            <button
              v-for="row in visible"
              :key="row.config.id"
              class="connection-row"
              :class="{ active: active?.config.id === row.config.id }"
              @click="select(row)"
            >
              <span class="drive-icon" :class="{ webdav: row.config.protocol === 'webdav' }"
                ><HardDrive v-if="row.config.protocol === 'smb'" :size="21" /><Link2
                  v-else
                  :size="21"
              /></span>
              <span class="row-copy"
                ><strong>{{ row.config.name }}</strong
                ><span>{{ address(row.config) }}</span></span
              ><span class="dot" :class="row.state.status"></span>
            </button>
            <div class="list-footer">{{ visible.length }} 个连接 · 配置仅保存在本机</div>
          </section>

          <section v-if="active" class="details-panel" aria-label="连接详情">
            <div class="details-top">
              <span class="protocol-badge">{{ active.config.protocol.toUpperCase() }}</span
              ><span class="status-badge" :class="active.state.status"
                ><span class="dot" :class="active.state.status"></span
                >{{ labels[active.state.status] }}</span
              >
            </div>
            <h2 class="connection-name">{{ active.config.name }}</h2>
            <p class="details-description">
              {{ active.config.protocol === 'smb' ? 'NAS 共享目录' : 'WebDAV 远程目录' }}
            </p>
            <!-- 将连接与卸载放在详情上方，较小窗口也能直接访问核心操作。 -->
            <div class="connection-actions">
              <template v-if="active.state.status === 'mounted'"
                ><button
                  class="primary"
                  :disabled="store.busy"
                  @click="store.run(() => window.nexora.open(active!.config.id))"
                >
                  <FolderOpen :size="17" />打开文件夹</button
                ><button
                  :disabled="store.busy"
                  @click="store.run(() => window.nexora.unmount(active!.config.id), '目录已卸载。')"
                >
                  <Unplug :size="16" />卸载
                </button></template
              >
              <button
                v-else
                class="primary"
                :disabled="store.busy || !!isBusy(active)"
                @click="store.run(() => window.nexora.mount(active!.config.id), '远程目录已挂载。')"
              >
                <LoaderCircle v-if="isBusy(active)" class="spinning" :size="17" /><Cable
                  v-else
                  :size="17"
                />{{
                  active.state.status === 'error' || active.state.status === 'retrying'
                    ? '重新连接'
                    : '连接目录'
                }}
              </button>
              <button
                v-if="active.state.local && active.state.status !== 'mounted'"
                :disabled="store.busy"
                @click="store.run(() => window.nexora.unmount(active!.config.id), '目录已卸载。')"
              >
                <Unplug :size="16" />卸载残留连接
              </button>
              <button :disabled="store.busy" @click="test">
                <ShieldCheck :size="16" />测试连接
              </button>
            </div>
            <div class="mount-route">
              <div>
                <span class="route-label">远程位置</span><code>{{ address(active.config) }}</code>
              </div>
              <ArrowDownToLine :size="17" />
              <div>
                <span class="route-label">本地位置</span
                ><code>{{
                  active.state.local ||
                  (active.config.drive ? active.config.drive + '（尚未挂载）' : '连接后由系统分配')
                }}</code>
              </div>
            </div>
            <dl class="properties">
              <div>
                <dt>访问账号</dt>
                <dd>{{ active.config.username || '系统身份 / 访客' }}</dd>
              </div>
              <div>
                <dt>凭证</dt>
                <dd>{{ active.hasPassword ? '已加密保存' : '未保存密码' }}</dd>
              </div>
              <div>
                <dt>自动连接</dt>
                <dd>{{ active.config.autoConnect ? '登录后连接' : '手动连接' }}</dd>
              </div>
              <div>
                <dt>访问模式</dt>
                <dd>
                  {{
                    active.state.status === 'mounted'
                      ? active.state.readOnly
                        ? '系统报告：只读'
                        : '按服务端权限访问'
                      : '连接后检查'
                  }}
                </dd>
              </div>
            </dl>
            <div v-if="active.state.error" class="inline-error">
              <CircleHelp :size="18" />
              <div>
                <strong>{{ active.state.error.message }}</strong>
                <p v-if="active.state.retryAt">网络恢复后将自动重试，也可以点击重新连接。</p>
                <p v-if="active.state.error.detail">系统错误码：{{ active.state.error.detail }}</p>
              </div>
            </div>
            <div v-if="active.state.readOnly" class="help-box">
              此目录由系统以只读方式挂载。WebDAV 请检查服务端 LOCK 支持及账号权限。
            </div>

            <div v-if="probe" class="probe-box" role="status">
              <strong>{{
                probe.available && probe.reachable
                  ? '系统能力可用，网络端口可达'
                  : !probe.available
                    ? '当前系统缺少挂载能力'
                    : '远程服务端口不可达'
              }}</strong>
              <p>测试不创建文件，账号与目录权限由实际挂载确认。</p>
              <p v-for="warning in probe.warnings" :key="warning">{{ warning }}</p>
            </div>
            <div class="details-footer">
              <span><ShieldCheck :size="14" />系统直接读写远程文件</span>
              <div>
                <button
                  class="text-button"
                  :disabled="store.busy || !!active.state.local || !!isBusy(active)"
                  @click="edit(active)"
                >
                  <Pencil :size="14" />编辑</button
                ><button
                  v-if="!confirmedRemoval"
                  class="text-button muted"
                  :disabled="store.busy || !!active.state.local || !!isBusy(active)"
                  @click="confirmedRemoval = true"
                >
                  <Trash2 :size="14" />删除</button
                ><button
                  v-else
                  class="text-button destructive"
                  :disabled="store.busy"
                  @click="remove"
                >
                  确认删除
                </button>
              </div>
            </div>
          </section>
          <section v-else class="welcome-panel">
            <div class="welcome-symbol">
              <HardDrive :size="44" /><span><Link2 :size="19" /></span>
            </div>
            <h2>一份项目，两端继续。</h2>
            <p>把 NAS 上的共享目录连接到电脑，<br />让编辑器与 AI 工具访问同一份工作文件。</p>
            <div class="welcome-protocols"><span>SMB</span><span>WebDAV</span></div>
            <button class="primary" @click="edit()"><Plus :size="17" />添加远程目录</button>
            <p class="welcome-footnote">从局域网连接开始</p>
          </section>
        </div>
        <div class="bottom-note">
          <CircleHelp :size="15" />并行修改项目时，请继续协调 AI 任务，避免同时覆盖同一处内容。
        </div>
      </section>

      <section v-else-if="page === 'settings'" class="workspace settings-page">
        <div class="page-heading">
          <div>
            <p class="eyebrow">MAKE IT YOURS</p>
            <h1>偏好设置</h1>
            <p class="subtitle">让远程目录融入你的日常工作。</p>
          </div>
        </div>
        <div class="settings-card">
          <h2>启动与运行</h2>
          <label
            ><span><strong>登录时启动</strong><small>登录系统后启动 Nexora Mount。</small></span
            ><input
              type="checkbox"
              :checked="store.snapshot.settings.login"
              :disabled="store.busy"
              @change="settings('login', $event)" /></label
          ><label
            ><span
              ><strong>关闭窗口后留在托盘</strong
              ><small>通过菜单栏或系统托盘再次打开。</small></span
            ><input
              type="checkbox"
              :checked="store.snapshot.settings.closeToTray"
              :disabled="store.busy"
              @change="settings('closeToTray', $event)" /></label
          ><label
            ><span
              ><strong>连接断开后自动重试</strong
              ><small>仅重试网络错误；账号或证书错误需要你处理。</small></span
            ><input
              type="checkbox"
              :checked="store.snapshot.settings.reconnect"
              :disabled="store.busy"
              @change="settings('reconnect', $event)"
          /></label>
        </div>
        <div class="help-box">
          <ShieldCheck :size="18" />
          <div>退出应用会保留系统挂载。需要断开时，请在连接详情中选择“卸载”。</div>
        </div>
        <div class="settings-card">
          <h2>WebDAV 使用说明</h2>
          <p>
            Windows 需要 WebClient 服务，且受当前系统单文件大小限制。macOS 原生 WebDAV
            的写入需要服务端支持文件锁。
          </p>
          <p>
            HTTPS
            自签证书应先通过操作系统证书管理工具建立信任，并确保地址与证书域名一致。应用不会绕过证书校验。
          </p>
        </div>
      </section>

      <section v-else class="workspace">
        <div class="page-heading">
          <div>
            <p class="eyebrow">A CLEARER CONNECTION</p>
            <h1>连接诊断</h1>
            <p class="subtitle">先预览，再导出。你可以编辑即将分享的内容。</p>
          </div>
          <button
            class="primary"
            @click="
              store.run(async () => {
                const saved = await window.nexora.exportDiagnostics(diagnostic)
                if (saved) store.notify('诊断信息已导出。')
              })
            "
          >
            <ArrowDownToLine :size="17" />导出诊断
          </button>
        </div>
        <div class="help-box">
          <ShieldCheck :size="18" />
          <div>诊断包含系统类型、连接状态和操作记录；不包含远程地址、账号、密码或工作文件。</div>
        </div>
        <textarea
          v-model="diagnostic"
          class="diagnostic-editor"
          aria-label="诊断信息预览"
          spellcheck="false"
        ></textarea
        ><button @click="diagnostics"><RefreshCw :size="16" />重新生成</button>
      </section>
    </main>

    <div
      v-if="modal"
      class="modal-backdrop"
      @click.self="!store.busy && close()"
      @keydown="keyboard"
    >
      <form
        ref="formElement"
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        @submit.prevent="save"
      >
        <div class="modal-heading">
          <div>
            <p class="eyebrow">CONNECT YOUR WORKSPACE</p>
            <h2 id="dialog-title">{{ editing ? '编辑连接' : '添加远程目录' }}</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭对话框"
            :disabled="store.busy"
            @click="close"
          >
            <X :size="19" />
          </button>
        </div>
        <div class="protocol-switch">
          <button
            type="button"
            :class="{ chosen: form.protocol === 'smb' }"
            @click="form.protocol = 'smb'"
          >
            <HardDrive :size="17" />SMB 共享</button
          ><button
            type="button"
            :class="{ chosen: form.protocol === 'webdav' }"
            @click="form.protocol = 'webdav'"
          >
            <Link2 :size="17" />WebDAV
          </button>
        </div>
        <label
          >连接名称<input
            v-model="form.name"
            required
            maxlength="64"
            placeholder="例如：NAS 工作项目"
        /></label>
        <div v-if="form.protocol === 'smb'" class="form-columns">
          <label>主机名或 IP<input v-model="form.host" required placeholder="192.168.1.10" /></label
          ><label>共享名称<input v-model="form.share" required placeholder="Projects" /></label>
        </div>
        <label v-else
          >WebDAV 地址<input
            v-model="form.url"
            type="url"
            required
            placeholder="https://nas.example.com/dav/"
          /><small>包含完整路径，账号和密码在下方填写。</small></label
        >
        <div class="form-columns">
          <label
            >用户名<input
              v-model="form.username"
              autocomplete="username"
              placeholder="系统身份 / 访客可留空" /></label
          ><label
            >密码<input
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              :disabled="form.clearPassword"
              :placeholder="editing ? '留空保留已保存密码' : '可选，加密保存在本机'"
          /></label>
        </div>
        <label v-if="editing" class="checkbox-line"
          ><input v-model="form.clearPassword" type="checkbox" />清除已保存的密码</label
        ><label v-if="store.snapshot.platform === 'win32'"
          >本地盘符<select v-model="form.drive">
            <option value="">自动分配可用盘符</option>
            <option v-for="letter in 'DEFGHIJKLMNOPQRSTUVWXYZ'" :key="letter" :value="letter + ':'">
              {{ letter }}:
            </option>
          </select></label
        ><label class="checkbox-line"
          ><input v-model="form.autoConnect" type="checkbox" />应用启动后自动连接</label
        >
        <div v-if="store.message && store.error" role="alert" class="inline-error">
          {{ store.message }}
        </div>
        <div class="form-note">
          <ShieldCheck :size="15" />凭证经过系统加密，连接配置保存在本机。
        </div>
        <footer>
          <button type="button" :disabled="store.busy" @click="close">取消</button
          ><button class="primary" type="submit" :disabled="store.busy">
            <LoaderCircle v-if="store.busy" class="spinning" :size="16" />保存连接
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>
