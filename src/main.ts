import './style.css';
import { Game } from './game';
import { loadAtlas } from './render/sprites';
import { preloadTitleArt } from './ui/title/art';
import { isStageId } from './world/stages';

declare global {
  interface Window { __game?: Game }
}

async function boot(): Promise<void> {
  const root = document.getElementById('app')!;
  const params = new URLSearchParams(location.search);
  const seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : undefined;
  try {
    // a paisagem e os samurais do título chegam junto com o atlas (a tela não abre com a arte faltando)
    const [atlas] = await Promise.all([loadAtlas(), params.has('autostart') ? undefined : preloadTitleArt()]);
    const c = params.get('char');
    const character = c === 'ronin' || c === 'tomoe' ? c : undefined;
    const st = params.get('stage');
    const stage = isStageId(st) ? st : undefined;
    const game = new Game(root, atlas, { seed, autostart: params.has('autostart'), character, stage });
    window.__game = game;
    document.getElementById('boot')?.remove();
  } catch (err) {
    const boot = document.getElementById('boot');
    if (boot) boot.textContent = 'Não foi possível iniciar o WebGL neste navegador. Tente atualizar a página ou usar outro navegador.';
    console.error(err);
  }
}

void boot();
