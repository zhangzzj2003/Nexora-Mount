import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Snapshot } from '../../shared/types'

export const useConnections = defineStore('connections', () => {
  const snapshot = ref<Snapshot>({
    connections: [],
    settings: { login: false, closeToTray: true, reconnect: true },
    platform: '',
    version: ''
  })
  const message = ref('')
  const error = ref(false)
  const busy = ref(false)
  let subscribed = false
  function notify(text: string, failed = false) {
    message.value = text
    error.value = failed
  }
  async function initialize() {
    if (!subscribed) {
      window.nexora.onChange((value) => {
        snapshot.value = value
      })
      subscribed = true
    }
    try {
      snapshot.value = await window.nexora.snapshot()
    } catch {
      notify('无法连接桌面服务，请重新启动应用。', true)
    }
  }
  async function run(action: () => Promise<unknown>, success?: string) {
    busy.value = true
    message.value = ''
    try {
      await action()
      if (success) notify(success)
      return true
    } catch (e) {
      notify((e as Error).message || '操作未完成，请重试。', true)
      return false
    } finally {
      busy.value = false
    }
  }
  return { snapshot, message, error, busy, initialize, notify, run }
})
