import './style.css'
import '@xterm/xterm/css/xterm.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
