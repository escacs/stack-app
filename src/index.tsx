import '../web-vendor/style.css';
import './app.css';
import { render } from 'solid-js/web';
import App from './App';

// Dotted leaders in the vendored web stylesheet read this var (the stack
// website's web/app.js sets the same value).
document.documentElement.style.setProperty('--dots', JSON.stringify('. '.repeat(120)));

const root = document.getElementById('root');
if (root) {
  // Drop the shell's boot placeholder (index.html is shell-owned); Solid
  // appends into the mount node instead of replacing it.
  root.replaceChildren();
  render(() => <App />, root);
}
