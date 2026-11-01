import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import { nextTick, onMounted, onUnmounted, watch } from 'vue';
import { applyTheme, readThemeSelection, writeStorage, MODE_STORAGE_KEY, THEME_STORAGE_KEYS } from './shared/theme';
import './custom.css';

// 原先有个按链接文字「返回主站」拦截点击、跳站点根的补丁，导航项删掉后它就是死代码，
// 而且靠文字匹配认链接正是侧栏与正文跑偏的那类耦合。要回主站的入口，
// 在 config.mts 的 nav 里加一项并用绝对域名，别再往主题里塞隐式规则。
export default {
  extends: DefaultTheme,
  setup() {
    const { isDark } = useData();
    let syncing = false;
    let stop: (() => void) | undefined;
    const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const selection = readThemeSelection();
      syncing = true;
      isDark.value = applyTheme(selection) === 'dark';
      void nextTick(() => { syncing = false; });
    };
    const onStorage = (event: StorageEvent) => { if (event.key === null || THEME_STORAGE_KEYS.includes(event.key)) sync(); };
    const onSystem = () => { if (readThemeSelection().mode === 'system') sync(); };
    onMounted(() => {
      sync();
      stop = watch(isDark, dark => {
        if (syncing) return;
        const selection = { ...readThemeSelection(), mode: dark ? 'dark' as const : 'light' as const };
        writeStorage(MODE_STORAGE_KEY, selection.mode);
        applyTheme(selection);
      });
      window.addEventListener('storage', onStorage);
      media?.addEventListener('change', onSystem);
    });
    onUnmounted(() => { stop?.(); window.removeEventListener('storage', onStorage); media?.removeEventListener('change', onSystem); });
  },
};
