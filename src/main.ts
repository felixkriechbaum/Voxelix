import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { applyTheme } from './editor/theme';
import './style.css';

applyTheme();
createApp(App).use(createPinia()).mount('#app');
