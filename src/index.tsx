import '../web-vendor/style.css';
// stack-alabaster: tokens first, then the dark values, then component CSS,
// then the app's own sheet (see src/styles/stack-alabaster/README.md).
import './styles/stack-alabaster/tokens.css';
import './styles/stack-alabaster/tokens-dark.css';
import './styles/stack-alabaster/button.css';
import './styles/stack-alabaster/icon-button.css';
import './styles/stack-alabaster/badge.css';
import './styles/stack-alabaster/kbd.css';
import './styles/stack-alabaster/nav-item.css';
import './styles/stack-alabaster/split-pill.css';
import './styles/stack-alabaster/well.css';
import './styles/stack-alabaster/sunken.css';
import './styles/stack-alabaster/segmented-control.css';
import './styles/stack-alabaster/search-field.css';
import './styles/stack-alabaster/alert.css';
import './styles/stack-alabaster/toast.css';
import './styles/stack-alabaster/dialog.css';
import './styles/stack-alabaster/command.css';
import './styles/stack-alabaster/shell.css';
import './styles/humanize.css';
import './app.css';
import './styles/stack-alabaster/dark-fixes.css';
import { render } from 'solid-js/web';
import App from './App';
import { initTheme } from './theme';
import { initTooltips } from './tooltip';
import { trackWindowShape } from './windowShape';

// Dotted leaders in the vendored web stylesheet read this var (the stack
// website's web/app.js sets the same value).
document.documentElement.style.setProperty('--dots', JSON.stringify('. '.repeat(120)));

initTheme();
const detachTips = initTooltips();
trackWindowShape();
if (import.meta.hot) import.meta.hot.dispose(() => detachTips());

const root = document.getElementById('root');
if (root) {
  // Drop the shell's boot placeholder (index.html is shell-owned); Solid
  // appends into the mount node instead of replacing it.
  root.replaceChildren();
  render(() => <App />, root);
}
