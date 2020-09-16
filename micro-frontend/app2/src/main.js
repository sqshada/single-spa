import Vue from 'vue'
import App from './App.vue'
import router from './router/index'
import singleSpaVue from 'single-spa-vue'

Vue.config.productionTip = false

const appOptions = {
  el: '#microApp',
  router,
  render: h => h(App)
}

// 支持应用独立运行、部署，不依赖于基座应用
if (!window.singleSpaNavigate) {
  delete appOptions.el
  new Vue(appOptions).$mount('#app')
}

// 基于底座应用，导出生命周期函数
const vueLifecycle = singleSpaVue({
  Vue,
  appOptions
})

export function bootstrap(props) {
  console.log('app2 bootstrap', props)
  return vueLifecycle.bootstrap(() => {})
}

export function mount(props) {
  console.log('app2 mount', props)
  return vueLifecycle.mount(() => {})
}

export function unmount(props) {
  console.log('app2 unmount', props)
  return vueLifecycle.unmount(() => {})
}