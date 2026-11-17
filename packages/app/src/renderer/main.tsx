import { render } from 'preact';
import { App } from './App';
import './styles.css';

// Vibrancy is a window property; the page only needs to know whether to let it show through
if (new URLSearchParams(location.search).get('vibrancy') === '1') document.documentElement.classList.add('vibrant');

render(<App />, document.getElementById('app')!);
