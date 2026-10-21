import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'

// 所有系统操作经 preload 的有限接口完成，界面不接触文件系统及明文持久化凭证。
createApp(App).use(createPinia()).mount('#app')
