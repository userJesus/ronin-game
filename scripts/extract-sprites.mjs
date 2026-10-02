// Extrai as poses do samurai das folhas de referência (fundo verde) e gera um atlas em pixel art:
//   src/assets/sprites/samurai.png + samurai.json      (npm run sprites)
// Folhas:
//   assets-src/movement.png — movimentação geral (4 linhas, 9/9/9/8 quadros)
//   assets-src/combat.png   — ataque, defesa, parry e esquiva (4 linhas × 5)
//   assets-src/special.png  — golpe especial Kiai: concentração (9) e explosão (6)
//   assets-src/movement2.png — locomoção natural (4 linhas: 16/16/21/21 quadros, muitos encostados)
//   assets-src/tomoe-*.png   — personagem Tomoe: movimentação (6×12), combate (7/6/6/6) e especial (6/6/5)
//   assets-src/lion-*.png    — forma de leão do Ronin: transformação (8/7/6), movimentação nas 8 direções
//                              (6 linhas, dois blocos), garra (5/4/4/5) e rugido (5/4/4); todos na escala LION_H
//                              (LION_DUMP=1 mostra a escala e o tamanho de cada quadro do leão)
// Passos por folha: chroma key com alfa suave -> componentes conexos -> uma pose por componente
// grande (efeitos brancos soltos vão para a pose mais próxima via transformada de distância)
// -> tom de cinza normalizado entre folhas -> redução por supersampling com fator por linha
// (as folhas geradas por IA mudam de escala entre linhas) -> alfa binário + paleta comum.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT_DIR = path.join(ROOT, 'src/assets/sprites');
/** Altura (texels) de um samurai de pé; 32 texels = 1 m. */
const STAND = 64;
/**
 * Altura (texels) do leão andando em três-quartos de frente; todos os quadros do leão (movimentação, ataques
 * e o fim da transformação) seguem essa escala. 56 = o leão do tamanho em que a folha da transformação o
 * desenha ao lado do samurai (64).
 */
const LION_H = 56;

// `ref`: índices dos quadros usados para medir a escala da linha; `h`: altura que eles devem ter;
// `factorFrom`: reaproveita o fator de outra linha (folhas desenhadas numa escala só).
const seqFrom = (prefix, a, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(a + i).padStart(2, '0')}`);
const seq = (prefix, n) => seqFrom(prefix, 0, n);
const tfRange = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `tf${String(a + i).padStart(2, '0')}`);
/** Quadros que a folha tem mas o jogo não usa: entram na separação, ficam fora do atlas. */
const skip = (tag, n) => Array.from({ length: n }, (_, i) => `_${tag}${i}`);
const SHEETS = [
  {
    file: 'assets-src/movement.png',
    rows: [
      { names: ['walkS0', 'walkS1', 'walkS2', 'walkN0', 'walkN1', 'walkN2', 'runE0', 'runE1', 'runE2'], ref: [0, 1, 2, 3, 4, 5], h: STAND },
      { names: ['walkN3', 'walkN4', 'walkN5', 'walkE0', 'walkE1', 'walkE2', 'runE3', 'runE4', 'runE5'], ref: [0, 1, 2], h: STAND },
      { names: ['idleSE0', 'idleSE1', 'idleSE2', 'walkSE0', 'walkSE1', 'walkSE2', 'walkSE3', 'walkSE4', 'walkSE5'], ref: [0, 1, 2], h: STAND },
      { names: ['walkNW0', 'walkNW1', 'walkNW2', 'walkNW3', 'front', 'crouch', 'raise', 'slash'], ref: [0, 1, 2, 3], h: STAND, refB: { from: 4, ref: [4], h: STAND } },
    ],
  },
  {
    file: 'assets-src/combat.png',
    rows: [
      { names: ['atkStance', 'atkRaise', 'atkSlash', 'atkArc', 'atkFinish'], ref: [0], h: STAND * 0.94 },
      { names: ['guardStance', 'guardRaise', 'guardHold', 'guardBlock', 'guardExit'], ref: [0, 4], h: STAND * 0.94 },
      { names: ['parryStance', 'parryReady', 'parrySpark', 'parryRiposte', 'parryFinish'], ref: [0], h: STAND * 0.94 },
      { names: ['dash0', 'dash1', 'dash2', 'dash3', 'dashLand'], ref: [0], h: STAND * 0.9 },
    ],
  },
  {
    file: 'assets-src/movement2.png',
    // quadros encostados uns nos outros: cortes verticais automáticos pelo mínimo de pixels,
    // sabendo quantos quadros há em cada linha; a separação fina segue o vão entre as figuras (costuras)
    autoCuts: { rowsY: [237, 470, 700], minW: 45, maxW: 150, seams: true },
    rows: [
      { names: seq('m2a', 16), ref: [0, 1, 2, 3, 4, 5, 6, 7], h: STAND },
      { names: seq('m2b', 16), ref: [0, 1, 2, 3, 4, 5, 6, 7], h: STAND, factorFrom: 0 },
      { names: seq('m2c', 21), ref: [0, 1, 2, 3, 4, 5], h: STAND, factorFrom: 0 },
      { names: seq('m2d', 21), ref: [0, 1, 2, 3, 4, 5], h: STAND, factorFrom: 0 },
    ],
  },
  {
    file: 'assets-src/tomoe-movement.png',
    toneGroup: 'tomoe',
    rows: [
      { names: seq('tmA', 12), ref: [0, 1, 2, 3, 4, 5], h: STAND },
      { names: seq('tmB', 12), ref: [0, 1, 2, 3, 4, 5], h: STAND },
      // perfis desenhados menores na folha: normalizados na própria linha (andando ~4% mais baixo que de pé)
      { names: seq('tmC', 12), ref: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], h: STAND * 0.96 },
      { names: seq('tmD', 12), ref: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], h: STAND * 0.96 },
      { names: seq('tmE', 12), ref: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], h: STAND * 0.96 },
      { names: seq('tmF', 12), ref: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], h: STAND * 0.96 },
    ],
  },
  {
    file: 'assets-src/tomoe-combat.png',
    // o rastro do golpe gruda dois quadros da 1ª linha: cortes + crescimento de região pelo tronco
    autoCuts: { rowsY: [315, 570, 820], minW: 60, maxW: 330, geodesic: true, manualCols: { 0: [195, 376, 575, 780, 990, 1242] } },
    toneGroup: 'tomoe',
    rows: [
      { names: seq('tcA', 7), ref: [0, 6], h: STAND },
      { names: seq('tcB', 6), ref: [0], h: STAND, factorFrom: 0 },
      { names: seq('tcC', 6), ref: [0], h: STAND, factorFrom: 0 },
      { names: seq('tcD', 6), ref: [0], h: STAND, factorFrom: 0 },
    ],
  },
  {
    file: 'assets-src/tomoe-special.png',
    // pétalas soltas vão para o corpo mais próximo; pé medido perto do tronco
    bodyWindow: 45,
    toneGroup: 'tomoe',
    rows: [
      { names: seq('tsA', 6), ref: [0], h: STAND * 0.97 },
      { names: seq('tsB', 6), ref: [0], h: STAND, factorFrom: 0 },
      { names: seq('tsC', 5), ref: [4], h: STAND, factorFrom: 0 },
    ],
  },
  {
    file: 'assets-src/lion-transform.png',
    // transformação do Ronin em leão: 21 quadros soltos (componentes separados); fiapos de aura vão para o
    // quadro mais próximo. Samurai e homem-fera na escala do samurai; o leão (última linha) na escala do leão,
    // quadro a quadro (a folha desenha o último leão maior), para não estalar quando a forma começa.
    toneRef: ['tf00'],
    // a pelagem não entra no cálculo da paleta comum: Ronin, Tomoe e horda ficam com as cores de antes
    palette: false,
    rows: [
      { names: tfRange(0, 7), ref: [0], h: STAND },
      { names: tfRange(8, 14), ref: [0], h: STAND, factorFrom: 0 },
      { names: tfRange(15, 20), ref: [0], h: STAND, factorFrom: 0, lionScale: 'frame' },
    ],
  },
  {
    file: 'assets-src/lion-movement.png',
    // leão nas 8 direções, bloco esquerdo | bloco direito (x = 800):
    //   1-2: de frente (andar 6, galope 6) | de costas (andar 6, galope 6)
    //   3-4: de lado para a esquerda (andar 5, galope 5) | para a direita (andar 5, galope 5)
    //   5: três-quartos de costas, cima-esquerda (6) | cima-direita (6)
    //   6: três-quartos de frente, baixo-esquerda (6) | baixo-direita (6)
    // Caudas e patas se intercalam entre vizinhos: costuras entre os cortes.
    autoCuts: {
      rowsY: [189, 354, 493, 628, 777], minW: 80, maxW: 260, seams: true,
      manualCols: {
        0: [136, 247, 376, 490, 597, 801, 1007, 1114, 1222, 1362, 1474],
        1: [125, 241, 380, 496, 607, 802, 994, 1111, 1225, 1361, 1483],
        2: [168, 309, 451, 597, 794, 986, 1128, 1280, 1427],
        4: [150, 265, 381, 494, 607, 796, 989, 1111, 1219, 1334, 1460],
      },
    },
    toneGroup: 'lion',
    palette: false,
    // chão fixo por bloco (esquerda/direita de x = 800): a passada desenhada fica, o quadro não quica pelo pé.
    // Linhas com `ground: 'frame'`: a folha desenha a linha com a base inclinada (o leão subia até 8 texels
    // de um quadro para o outro) — pé medido em cada quadro.
    blockBase: 800,
    // escala por bloco, igualando os blocos da mesma vista (`views`: esquerdo, direito) — ver "escala do leão"
    lionScale: 'blocks',
    rows: [
      { names: [...seq('lwS', 6), ...seq('lwN', 6)], views: ['S', 'N'] },
      { names: [...seq('lrS', 6), ...seq('lrN', 6)], views: ['S', 'N'] },
      { names: [...seq('lwW', 5), ...seq('lwE', 5)], views: ['side', 'side'] },
      { names: [...seq('lrW', 5), ...seq('lrE', 5)], views: ['side', 'side'], ground: 'frame' },
      { names: [...seq('lNW', 6), ...seq('lNE', 6)], views: ['NWE', 'NWE'], ground: 'frame' },
      { names: [...seq('lSW', 6), ...seq('lSE', 6)], views: ['SWE', 'SWE'], ground: 'frame' },
    ],
  },
  {
    file: 'assets-src/lion-claw.png',
    // ataque básico do leão (garra), virado para a direita: 5/4/4/5 quadros (lclaw00..17).
    // O rastro branco da garra encosta na cauda do quadro seguinte: costuras entre os cortes.
    autoCuts: {
      rowsY: [300, 557, 808], minW: 150, maxW: 420, seams: true, seamBias: 2e-4,
      manualCols: {
        0: [276, 559, 835, 1140],
        1: [369, 716, 1088],
        2: [412, 773, 1097],
        3: [292, 567, 846, 1127],
      },
    },
    toneGroup: 'lion',
    palette: false,
    // a folha desenha o leão maior em alguns quadros (o rugido cresce): escala por quadro
    lionScale: 'frame',
    rows: [
      { names: seqFrom('lclaw', 0, 5) },
      { names: seqFrom('lclaw', 5, 4) },
      { names: seqFrom('lclaw', 9, 4) },
      { names: seqFrom('lclaw', 13, 5) },
    ],
  },
  {
    file: 'assets-src/lion-roar.png',
    // ataque carregado do leão (rugido), virado para a direita: 5/4/4 quadros (lroar00..12); as ondas do
    // rugido ficam no quadro de quem ruge
    autoCuts: {
      rowsY: [365, 700], minW: 150, maxW: 460, seams: true, seamBias: 2e-4,
      manualCols: {
        0: [272, 570, 858, 1152],
        1: [330, 662, 1088],
        2: [415, 790, 1117],
      },
    },
    toneGroup: 'lion',
    palette: false,
    // a folha desenha o leão maior em alguns quadros (o rugido cresce): escala por quadro
    lionScale: 'frame',
    rows: [
      { names: seqFrom('lroar', 0, 5) },
      { names: seqFrom('lroar', 5, 4) },
      { names: seqFrom('lroar', 9, 4) },
    ],
  },
  {
    file: 'assets-src/special.png',
    // pedaços grandes do anel de fogo não são personagem: só conta componente com muito pixel escuro
    minDark: 5000,
    // os anéis quase encostam no quadro vizinho: dono do pixel pela coluna, não pela proximidade
    cells: { splitY: 380, cols: [[236, 452, 662, 850, 1092, 1320, 1553, 1780], [425, 815, 1206, 1542, 1828]] },
    // fumaça escura em volta: pé e topo medidos só perto do tronco
    bodyWindow: 45,
    // tom medido só nos quadros de postura (sem fogo nem fumaça)
    toneRef: ['kiai0', 'kiaiBlast5'],
    rows: [
      { names: ['kiai0', 'kiai1', 'kiai2', 'kiai3', 'kiai4', 'kiai5', 'kiai6', 'kiai7', 'kiai8'], ref: [0], h: STAND * 0.97 },
      { names: ['kiaiBlast0', 'kiaiBlast1', 'kiaiBlast2', 'kiaiBlast3', 'kiaiBlast4', 'kiaiBlast5'], ref: [5], h: STAND * 0.97 },
    ],
  },
];

function loadSheet(file) {
  const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, file)));
  const { width: W, height: H, data } = png;
  // cor de fundo: mediana dos cantos
  const corner = [];
  for (const [cx, cy] of [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]]) { const i = (cy * W + cx) * 4; corner.push([data[i], data[i + 1], data[i + 2]]); }
  const bg = [0, 1, 2].map(k => corner.map(c => c[k]).sort((a, b) => a - b)[1]);
  const alpha = new Float32Array(W * H), gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const a = Math.max(0, Math.min(1, 1 - (g - Math.max(r, b) - 50) / 140));
    alpha[i] = a;
    if (a > 0) {
      const cr = (r - (1 - a) * bg[0]) / a, cb = (b - (1 - a) * bg[2]) / a;
      gray[i] = Math.max(0, Math.min(255, (cr + cb) / 2));
    }
  }
  return { W, H, alpha, gray };
}

function components(s) {
  const { W, H, alpha } = s;
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let st = 0; st < W * H; st++) {
    if (alpha[st] < 0.35 || label[st] >= 0) continue;
    const id = comps.length, stack = [st];
    label[st] = id;
    let n = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, dark = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0;
      n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (s.gray[p] < 90) dark++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (label[q] < 0 && alpha[q] >= 0.35) { label[q] = id; stack.push(q); }
      }
    }
    comps.push({ id, n, dark, cx: sx / n, cy: sy / n, x0, y0, x1, y1 });
  }
  return { label, comps };
}

/** Cada pixel recebe o quadro (componente grande) mais próximo — BFS multi-fonte, 8-vizinhança. */
function nearestOwner(s, label, bigIndex) {
  const { W, H } = s;
  const owner = new Int16Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) {
    const f = label[i] >= 0 ? bigIndex.get(label[i]) : undefined;
    if (f !== undefined) { owner[i] = f; queue[qt++] = i; }
  }
  while (qh < qt) {
    const p = queue[qh++], x = p % W, y = (p / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (owner[q] < 0) { owner[q] = owner[p]; queue[qt++] = q; }
    }
  }
  return owner;
}

/** Linha e coluna de célula (folhas com fronteiras explícitas). */
function rowsYOf(cfg) { return cfg.cells.rowsY ?? [cfg.cells.splitY]; }
function cellOf(cfg, x, y) {
  let row = 0;
  for (const by of rowsYOf(cfg)) if (y >= by) row++;
  let col = 0;
  for (const bx of cfg.cells.cols[row]) if (x >= bx) col++;
  return { row, col };
}
function cellOwner(s, cfg, label, comps) {
  const owner = new Int16Array(s.W * s.H).fill(-1);
  const base = [0];
  for (const r of cfg.rows) base.push(base[base.length - 1] + r.names.length);
  // pixel "sólido" = parte de um componente com pelo menos 4 pixels; bordas suaves a 1 px dele também valem
  const solid = i => label[i] >= 0 && comps[label[i]].n >= 4;
  for (let y = 1; y < s.H - 1; y++) for (let x = 1; x < s.W - 1; x++) {
    const i = y * s.W + x;
    if (s.alpha[i] <= 0.02) continue;
    if (!solid(i) && !solid(i - 1) && !solid(i + 1) && !solid(i - s.W) && !solid(i + s.W)) continue;
    const { row, col } = cellOf(cfg, x, y);
    owner[i] = base[row] + col;
  }
  return owner;
}
function cellRect(s, cfg, f) {
  const cols = cfg.cells.cols[f.ri], ys = rowsYOf(cfg);
  return {
    x0: f.ci === 0 ? 0 : cols[f.ci - 1], x1: f.ci >= cols.length ? s.W - 1 : cols[f.ci] - 1,
    y0: f.ri === 0 ? 0 : ys[f.ri - 1], y1: f.ri >= ys.length ? s.H - 1 : ys[f.ri] - 1,
  };
}

/** Cortes verticais por linha: k quadros -> k-1 colunas de menor soma de pixels (programação dinâmica). */
function autoCells(s, cfg) {
  const { rowsY, minW, maxW } = cfg.autoCuts;
  const bands = [0, ...rowsY, s.H];
  const cols = cfg.rows.map((r, ri) => {
    if (cfg.autoCuts.manualCols?.[ri]) return cfg.autoCuts.manualCols[ri];
    const k = r.names.length, y0 = bands[ri], y1 = bands[ri + 1];
    const prof = new Float64Array(s.W);
    for (let y = y0; y < y1; y++) for (let x = 0; x < s.W; x++) if (s.alpha[y * s.W + x] >= 0.35) prof[x]++;
    let first = 0, last = s.W - 1;
    while (first < s.W && prof[first] === 0) first++;
    while (last > 0 && prof[last] === 0) last--;
    const INF = 1e18;
    const dp = Array.from({ length: k }, () => new Float64Array(s.W + 1).fill(INF));
    const from = Array.from({ length: k }, () => new Int32Array(s.W + 1).fill(-1));
    dp[0][first] = 0;
    for (let i = 1; i < k; i++) for (let c = first + minW; c <= last; c++) {
      for (let w = minW; w <= maxW; w++) {
        const pc = c - w;
        if (pc < first) break;
        const v = dp[i - 1][pc];
        if (v >= INF) continue;
        // custo = pixels cortados; um pouco de preferência por larguras parecidas
        const cost = v + prof[c] * 10 + Math.abs(w - (last + 1 - first) / k) * 0.05;
        if (cost < dp[i][c]) { dp[i][c] = cost; from[i][c] = pc; }
      }
    }
    let best = -1, bv = INF;
    for (let c = first; c <= last; c++) {
      const w = last + 1 - c;
      if (w < minW || w > maxW) continue;
      if (dp[k - 1][c] < bv) { bv = dp[k - 1][c]; best = c; }
    }
    if (best < 0) throw new Error(`${cfg.file} linha ${ri}: sem cortes válidos`);
    const cuts = [];
    for (let i = k - 1, c = best; i > 0; c = from[i][c], i--) cuts.push(c);
    return cuts.reverse();
  });
  return { rowsY, cols };
}

function nearestIdx(arr, v) { let k = 0, bd = Infinity; arr.forEach((c, i) => { const d = Math.abs(c - v); if (d < bd) { bd = d; k = i; } }); return k; }
const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

// ------------------------------------------------------------------ extração
const sheets = SHEETS.map(cfg => {
  const s = loadSheet(cfg.file);
  const { label, comps } = components(s);
  if (cfg.autoCuts) return autoSheet(cfg, s, label, comps);
  const big = comps.filter(c => c.n > 3000 && c.dark >= (cfg.minDark ?? 0));
  const expected = cfg.rows.reduce((n, r) => n + r.names.length, 0);
  if (big.length !== expected) throw new Error(`${cfg.file}: esperava ${expected} poses, achei ${big.length}`);
  // agrupa em linhas pelo centro vertical e ordena por x
  big.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const c of big) {
    const row = rows.find(r => Math.abs(r.cy - c.cy) < 110);
    if (row) { row.items.push(c); row.cy = row.items.reduce((s2, it) => s2 + it.cy, 0) / row.items.length; } else rows.push({ cy: c.cy, items: [c] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  if (rows.length !== cfg.rows.length) throw new Error(`${cfg.file}: ${rows.length} linhas`);
  const bigIndex = new Map();
  const sheetFrames = [];
  rows.forEach((r, ri) => {
    r.items.sort((a, b) => a.cx - b.cx);
    if (r.items.length !== cfg.rows[ri].names.length) throw new Error(`${cfg.file} linha ${ri}: ${r.items.length} quadros`);
    r.items.forEach((c, ci) => {
      const f = { name: cfg.rows[ri].names[ci], ri, ci, comp: c, idx: sheetFrames.length };
      bigIndex.set(c.id, f.idx);
      sheetFrames.push(f);
    });
  });
  const owner = cfg.cells ? cellOwner(s, cfg, label, comps) : nearestOwner(s, label, bigIndex);
  measure(cfg, s, label, owner, sheetFrames);
  return { cfg, s, owner, label, frames: sheetFrames };
});

/**
 * Personagens sobrepostos (espada de um por cima do vizinho): semente no tronco de cada quadro e
 * crescimento de região só por dentro da silhueta (distância geodésica) — cada pixel fica com o
 * corpo que o alcança primeiro. Fragmentos soltos vão para o dono mais próximo pelo fundo.
 */
/** Coluna do tronco de cada quadro (a de mais pano escuro na faixa do tronco) e a própria faixa. */
function torsoSeeds(s, cfg) {
  const { W, H, alpha } = s;
  const ys = [0, ...cfg.cells.rowsY, H];
  return cfg.rows.map((r, ri) => {
    const cols = cfg.cells.cols[ri], y0 = ys[ri], y1 = ys[ri + 1];
    // altura útil da faixa: linhas com pixels opacos
    let top = y1, bot = y0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x += 2) if (alpha[y * W + x] >= 0.35) { top = Math.min(top, y); bot = Math.max(bot, y); }
    const ta = Math.round(top + (bot - top) * 0.3), tb = Math.round(top + (bot - top) * 0.62);
    return r.names.map((_, ci) => {
      const cx0 = ci === 0 ? 0 : cols[ci - 1], cx1 = ci >= cols.length ? W - 1 : cols[ci] - 1;
      // o corpo nem sempre está no meio da célula
      let mid = (cx0 + cx1) >> 1, bestN = -1;
      for (let x = cx0 + 6; x <= cx1 - 6; x++) {
        let n = 0;
        for (let y = ta; y <= tb; y += 2) for (let dx = -6; dx <= 6; dx += 3) { const i = y * W + x + dx; if (alpha[i] >= 0.6 && s.gray[i] < 110) n++; }
        if (n > bestN) { bestN = n; mid = x; }
      }
      return { mid, ta, tb, half: Math.max(4, ((cx1 - cx0) * 0.08) | 0) };
    });
  });
}

function geodesicOwner(s, cfg) {
  const { W, H, alpha } = s;
  const owner = new Int16Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let qh = 0, qt = 0;
  let idx = 0;
  for (const row of torsoSeeds(s, cfg)) {
    for (const { mid, ta, tb, half } of row) {
      for (let y = ta; y <= tb; y++) for (let x = mid - half; x <= mid + half; x++) {
        const i = y * W + x;
        if (alpha[i] >= 0.6 && s.gray[i] < 110 && owner[i] < 0) { owner[i] = idx; queue[qt++] = i; }
      }
      idx++;
    }
  }
  const grow = (inside) => {
    while (qh < qt) {
      const q = queue[qh++], x = q % W, y = (q / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (owner[n] >= 0 || (inside && alpha[n] < 0.35)) continue;
        owner[n] = owner[q]; queue[qt++] = n;
      }
    }
  };
  grow(true);
  // segunda passada pelo fundo: bordas suaves e fragmentos não alcançados por dentro
  qt = 0;
  for (let i = 0; i < W * H; i++) if (owner[i] >= 0) queue[qt++] = i;
  qh = 0;
  grow(false);
  // só pixels de verdade (fundo não é de ninguém)
  for (let i = 0; i < W * H; i++) if (alpha[i] <= 0.02) owner[i] = -1;
  return owner;
}

/**
 * Personagens encostados (manga tocando a manga do vizinho): entre os troncos de dois quadros vizinhos,
 * uma costura de cima a baixo (seam carving) que atravessa o mínimo de fronteira opaca, desviando até
 * SEAM_JOG colunas por linha. Ela segue o vão entre as figuras e só corta onde elas se tocam, no ponto
 * mais fino — o crescimento de região corria até a metade da distância entre os troncos e arrancava
 * um retângulo da manga do vizinho.
 */
function seamOwner(s, cfg) {
  const SEAM_JOG = 5, SEAM_MARGIN = 8;
  // `seamBias`: custo por pixel de distância do corte da célula, por linha — desempata entre costuras de custo
  // zero (efeitos em arcos soltos: sem ele a costura passa entre a boca e a primeira onda do rugido)
  const bias = cfg.autoCuts.seamBias ?? 0;
  const { W, H, alpha } = s;
  const op = (x, y) => (alpha[y * W + x] >= 0.35 ? 1 : 0);
  // fronteira cortada: par horizontal (x-1 | x) na linha y e par vertical (linha y-1 / y) na coluna x
  const hcut = (x, y) => Math.min(op(x - 1, y), op(x, y));
  const vcut = (x, y) => Math.min(op(x, y - 1), op(x, y));
  const owner = new Int16Array(W * H).fill(-1);
  const ys = [0, ...cfg.cells.rowsY, H];
  const seeds = torsoSeeds(s, cfg);
  let base = 0;
  cfg.rows.forEach((r, ri) => {
    const y0 = ys[ri], y1 = ys[ri + 1], n = y1 - y0;
    const seams = [];
    for (let k = 0; k + 1 < r.names.length; k++) {
      const a = seeds[ri][k].mid + SEAM_MARGIN, b = seeds[ri][k + 1].mid - SEAM_MARGIN;
      if (b <= a) throw new Error(`${cfg.file} linha ${ri}: troncos ${k} e ${k + 1} colados`);
      const span = b - a + 1, cut = cfg.cells.cols[ri][k];
      const off = x => bias * Math.abs(a + x - cut);
      let prev = new Float64Array(span), cur = new Float64Array(span);
      const from = new Int16Array(n * span);
      for (let x = 0; x < span; x++) prev[x] = hcut(a + x, y0) + off(x);
      for (let y = y0 + 1; y < y1; y++) {
        for (let x = 0; x < span; x++) {
          let best = Infinity, bi = x;
          for (let d = -SEAM_JOG; d <= SEAM_JOG; d++) {
            const px = x + d;
            if (px < 0 || px >= span) continue;
            // desvio: as colunas entre as duas posições trocam de lado entre as linhas; leve preferência por ficar reta
            let c = prev[px] + 0.01 * Math.abs(d);
            for (let cx = Math.min(px, x); cx < Math.max(px, x); cx++) c += vcut(a + cx, y);
            if (c < best) { best = c; bi = px; }
          }
          cur[x] = best + hcut(a + x, y) + off(x);
          from[(y - y0) * span + x] = bi;
        }
        [prev, cur] = [cur, prev];
      }
      let bx = 0;
      for (let x = 1; x < span; x++) if (prev[x] < prev[bx]) bx = x;
      const seam = new Int32Array(n);
      for (let y = y1 - 1; y >= y0; y--) { seam[y - y0] = a + bx; bx = from[(y - y0) * span + bx]; }
      seams.push(seam);
    }
    for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] <= 0.02) continue;
      let k = 0;
      while (k < seams.length && x >= seams[k][y - y0]) k++;
      owner[y * W + x] = base + k;
    }
    base += r.names.length;
  });
  reattachFragments(s, owner, base);
  return owner;
}

/**
 * Pedaço solto que a costura separou do dono (ponta de bainha do outro lado do corte): volta para o
 * quadro cujo corpo ele toca. Só pedaços pequenos perto do corpo principal de cada quadro.
 */
function reattachFragments(s, owner, nFrames) {
  const { W, H, alpha } = s;
  const seen = new Uint8Array(W * H);
  const comps = Array.from({ length: nFrames }, () => []);
  for (let st = 0; st < W * H; st++) {
    if (seen[st] || owner[st] < 0 || alpha[st] < 0.35) continue;
    const f = owner[st], px = [st], touch = new Map();
    seen[st] = 1;
    for (let h = 0; h < px.length; h++) {
      const p = px[h], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (alpha[q] < 0.35 || owner[q] < 0) continue;
        if (owner[q] !== f) { touch.set(owner[q], (touch.get(owner[q]) ?? 0) + 1); continue; }
        if (!seen[q]) { seen[q] = 1; px.push(q); }
      }
    }
    comps[f].push({ px, touch });
  }
  for (const list of comps) {
    if (!list.length) continue;
    const body = list.reduce((m, c) => (c.px.length > m.px.length ? c : m));
    for (const c of list) {
      if (c === body || c.px.length > body.px.length * 0.2 || !c.touch.size) continue;
      const to = [...c.touch].sort((p, q) => q[1] - p[1])[0][0];
      for (const p of c.px) owner[p] = to;
    }
  }
}

function autoSheet(cfg, s, label, comps) {
  cfg.cells = autoCells(s, cfg);
  const owner = cfg.autoCuts.seams ? seamOwner(s, cfg) : cfg.autoCuts.geodesic ? geodesicOwner(s, cfg) : cellOwner(s, cfg, label, comps);
  const frames = [];
  cfg.rows.forEach((r, ri) => r.names.forEach((name, ci) => {
    const f = { name, ri, ci, idx: frames.length };
    const cell = cellRect(s, cfg, f);
    const reg = cfg.autoCuts.geodesic || cfg.autoCuts.seams ? { ...cell, x0: Math.max(0, cell.x0 - 90), x1: Math.min(s.W - 1, cell.x1 + 90) } : cell;
    let x0 = s.W, y0 = s.H, x1 = 0, y1 = 0;
    for (let y = reg.y0; y <= reg.y1; y++) for (let x = reg.x0; x <= reg.x1; x++) {
      const i = y * s.W + x;
      if (owner[i] !== f.idx || s.alpha[i] < 0.35) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    f.comp = { id: -1, x0, y0, x1, y1 };
    f.region = reg;
    frames.push(f);
  }));
  measure(cfg, s, label, owner, frames);
  console.log(`  cortes ${cfg.file}: ${cfg.cells.cols.map(c => c.join(',')).join(' | ')}`);
  return { cfg, s, owner, label, frames };
}

// medidas do personagem (só pixels escuros = corpo; efeitos brancos não contam para pé/altura)
function measure(cfg, s, label, owner, sheetFrames) {
  for (const f of sheetFrames) {
    const reg = f.region ?? (cfg.cells ? cellRect(s, cfg, f) : { x0: f.comp.x0 - 120, x1: f.comp.x1 + 120, y0: f.comp.y0 - 60, y1: f.comp.y1 + 60 });
    let x0 = s.W, y0 = s.H, x1 = 0, y1 = 0, dy0 = s.H, dy1 = 0;
    // janela do corpo: mediana dos pixels escuros do próprio componente do personagem
    let wx0 = -Infinity, wx1 = Infinity;
    if (cfg.bodyWindow) {
      const xs = [];
      for (let y = f.comp.y0; y <= f.comp.y1; y++) for (let x = f.comp.x0; x <= f.comp.x1; x++) {
        const i = y * s.W + x;
        const mine = f.comp.id >= 0 ? label[i] === f.comp.id : owner[i] === f.idx;
        if (mine && s.gray[i] < 90) xs.push(x);
      }
      const mx = median(xs);
      wx0 = mx - cfg.bodyWindow; wx1 = mx + cfg.bodyWindow;
    }
    const rowDark = new Map();
    for (let y = Math.max(0, reg.y0); y <= Math.min(s.H - 1, reg.y1); y++) {
      for (let x = Math.max(0, reg.x0); x <= Math.min(s.W - 1, reg.x1); x++) {
        const i = y * s.W + x;
        if (owner[i] !== f.idx || s.alpha[i] < (cfg.lionScale ? 0.3 : 0.02)) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if (s.alpha[i] > 0.6 && s.gray[i] < 110 && x >= wx0 && x <= wx1) rowDark.set(y, (rowDark.get(y) ?? 0) + 1);
      }
    }
    // topo e pé: linhas com pelo menos 3 pixels escuros (partículas soltas não contam)
    for (const [y, n] of rowDark) if (n >= 3) { dy1 = Math.max(dy1, y); dy0 = Math.min(dy0, y); }
    Object.assign(f, { x0, y0, x1, y1, feet: dy1 + 1, top: dy0, bodyH: dy1 + 1 - dy0, wx0, wx1 });
  }
}

// tom: casa a mediana do "pano escuro" de cada folha com a da primeira
const clothMedian = sh => {
  const v = [];
  const ref = sh.cfg.toneRef ? new Set(sh.frames.filter(f => sh.cfg.toneRef.includes(f.name)).map(f => f.comp.id)) : null;
  for (let i = 0; i < sh.s.W * sh.s.H; i += 5) {
    if (sh.owner[i] < 0 || sh.s.alpha[i] <= 0.9 || sh.s.gray[i] >= 110) continue;
    if (ref && !ref.has(sh.label[i])) continue;
    v.push(sh.s.gray[i]);
  }
  return median(v);
};
// cada personagem casa as próprias folhas entre si (grupo = primeira folha dele)
const groupRef = new Map();
for (const sh of sheets) {
  const g = sh.cfg.toneGroup ?? 'ronin';
  const m = clothMedian(sh);
  if (!groupRef.has(g)) groupRef.set(g, m);
  sh.toneMul = Math.max(0.6, Math.min(1.4, groupRef.get(g) / m));
}

// chão fixo por bloco (folhas com blockBase): todos os quadros do bloco usam o pé mais baixo do bloco
for (const sh of sheets) {
  const split = sh.cfg.blockBase;
  if (split === undefined) continue;
  sh.cfg.rows.forEach((rc, ri) => {
    if (rc.ground === 'frame') return;
    for (const right of [false, true]) {
      const fs = sh.frames.filter(f => f.ri === ri && (f.comp.x0 + f.comp.x1) / 2 >= split === right);
      if (!fs.length) continue;
      const base = Math.max(...fs.map(f => f.feet));
      for (const f of fs) f.feet = base;
    }
  });
}

// fator de redução por linha (as linhas com factorFrom depois das medidas, podendo apontar para uma linha mais abaixo)
for (const sh of sheets) {
  const factorOf = (rowFrames, refIdx, h) => median(refIdx.map(i => rowFrames[i].bodyH)) / h;
  for (const pass of [0, 1]) sh.cfg.rows.forEach((rc, ri) => {
    if ((rc.factorFrom !== undefined) !== (pass === 1)) return;
    const rowFrames = sh.frames.filter(f => f.ri === ri);
    // folhas do leão: escala calculada depois (ver "escala do leão")
    if (sh.cfg.lionScale) return;
    const main = rc.factorFrom !== undefined
      ? sh.frames.find(f => f.ri === rc.factorFrom).factor
      : factorOf(rowFrames, rc.ref, rc.h);
    for (const f of rowFrames) f.factor = main;
    if (rc.refB) { const b = factorOf(rowFrames, rc.refB.ref, rc.refB.h); for (const f of rowFrames) if (f.ci >= rc.refB.from) f.factor = b; }
  });
}

// ------------------------------------------------------------------ escala do leão
// As folhas do leão (geradas por IA) mudam de escala entre linhas, blocos e até quadros (o leão do rugido
// cresce na folha). Medida de tamanho que quase não depende da pose nem dos efeitos brancos: raiz da contagem
// de pixels escuros (juba, contornos, cauda). "Escuro" é relativo ao pelo do próprio grupo de quadros (a
// mediana escura dele casada com a da folha de movimentação), não ao tom de exibição: a folha da transformação
// tem o tom casado pelo samurai.
// Movimentação: um fator por bloco; os blocos da mesma vista (andar/galope, esquerda/direita) ficam do mesmo
// tamanho, e o bloco de três-quartos de frente tem LION_H de altura. As vistas diferentes guardam a proporção
// da folha (de frente o leão é mais alto e estreito que de lado). Ataques e o leão da transformação: um fator
// por quadro, do tamanho do leão de perfil/três-quartos da movimentação.
const toned = (sh, g) => (g < 140 ? Math.min(255, g * sh.toneMul) : g);
const framePixels = (sh, f, fn) => {
  for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
    const i = y * sh.s.W + x;
    if (sh.owner[i] === f.idx && sh.s.alpha[i] > 0.6) fn(sh.s.gray[i]);
  }
};
const darkMedian = (sh, frames) => { const v = []; for (const f of frames) framePixels(sh, f, g => { if (g < 110) v.push(g); }); return median(v); };
const darkSize = (sh, f, thr) => { let n = 0; framePixels(sh, f, g => { if (g < thr) n++; }); return Math.sqrt(n); };
const lionMove = sheets.find(sh => sh.cfg.lionScale === 'blocks');
if (lionMove) {
  const lionDark = darkMedian(lionMove, lionMove.frames);
  const blocks = new Map();
  for (const f of lionMove.frames) {
    const b = (f.comp.x0 + f.comp.x1) / 2 >= lionMove.cfg.blockBase ? 1 : 0;
    const key = `${f.ri}:${b}`;
    if (!blocks.has(key)) blocks.set(key, { view: lionMove.cfg.rows[f.ri].views[b], frames: [] });
    f.dsize = darkSize(lionMove, f, 90);
    blocks.get(key).frames.push(f);
  }
  const list = [...blocks.values()];
  for (const bl of list) bl.size = median(bl.frames.map(f => f.dsize));
  const viewSize = {};
  for (const v of new Set(list.map(b => b.view))) {
    const bs = list.filter(b => b.view === v);
    viewSize[v] = bs.reduce((a, b) => a + b.size, 0) / bs.length;
  }
  // G: pixels da folha por texel no tamanho comum; a altura de referência é a do três-quartos de frente
  const G = median(list.filter(b => b.view === 'SWE').flatMap(b => b.frames.map(f => f.bodyH * viewSize.SWE / b.size))) / LION_H;
  for (const b of list) for (const f of b.frames) f.factor = G * b.size / viewSize[b.view];
  const ref = (viewSize.side + viewSize.SWE) / 2;
  for (const sh of sheets) {
    const fs = sh.frames.filter(f => sh.cfg.lionScale === 'frame' || sh.cfg.rows[f.ri].lionScale === 'frame');
    if (!fs.length) continue;
    const thr = 90 * darkMedian(sh, fs) / lionDark;
    for (const f of fs) { f.dsize = darkSize(sh, f, thr); f.factor = G * f.dsize / ref; }
    if (process.env.LION_DUMP) console.log('limiar', sh.cfg.file, thr.toFixed(1));
  }
  if (process.env.LION_DUMP) {
    for (const b of list) console.log('bloco', b.frames[0].name, b.view, 'tamanho', b.size.toFixed(1), 'fator', (G * b.size / viewSize[b.view]).toFixed(3));
    for (const sh of sheets) for (const f of sh.frames) if (f.dsize !== undefined)
      console.log('L', f.name.padEnd(8), 'fator', f.factor.toFixed(3), 'altura', (f.bodyH / f.factor).toFixed(1), 'largura', ((f.x1 + 1 - f.x0) / f.factor).toFixed(1), 'escuro', (f.dsize / f.factor).toFixed(1));
  }
}

// âncora: pé = linha mais baixa do corpo; x = mediana dos pixels escuros do tronco (25%..60% da altura)
for (const sh of sheets) for (const f of sh.frames) {
  const xs = [];
  const ta = f.top + f.bodyH * 0.25, tb = f.top + f.bodyH * 0.6;
  for (let y = Math.floor(ta); y <= tb; y++) for (let x = f.x0; x <= f.x1; x++) {
    const i = y * sh.s.W + x;
    if (sh.owner[i] === f.idx && sh.s.alpha[i] > 0.9 && sh.s.gray[i] < 90 && x >= f.wx0 && x <= f.wx1) xs.push(x);
  }
  f.torsoX = median(xs);
}

// paleta comum (k-means 1D)
const samples = [];
for (const sh of sheets) {
  if (sh.cfg.palette === false) continue;
  for (let i = 0; i < sh.s.W * sh.s.H; i += 7) if (sh.owner[i] >= 0 && sh.s.alpha[i] > 0.9) samples.push(toned(sh, sh.s.gray[i]));
}
let centers = [10, 30, 55, 85, 125, 175, 235];
for (let it = 0; it < 30; it++) {
  const sum = centers.map(() => 0), cnt = centers.map(() => 0);
  for (const v of samples) { const k = nearestIdx(centers, v); sum[k] += v; cnt[k]++; }
  centers = centers.map((c, k) => (cnt[k] ? sum[k] / cnt[k] : c));
}
centers = centers.map(Math.round).sort((a, b) => a - b);

// redução por supersampling (grade alinhada ao pé e ao tronco para as poses não tremerem)
const SS = 5;
const out = [];
for (const sh of sheets) for (const f of sh.frames) {
  if (f.name.startsWith('_')) continue;
  const F = f.factor, { W, H, alpha, gray } = sh.s;
  const left = Math.ceil((f.torsoX - f.x0) / F), right = Math.ceil((f.x1 + 1 - f.torsoX) / F);
  const up = Math.ceil((f.feet - f.y0) / F), down = Math.max(0, Math.ceil((f.y1 + 1 - f.feet) / F));
  const w = left + right, h = up + down;
  const px = new Uint8Array(w * h * 4);
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) {
    let as = 0, gs = 0, n = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = Math.floor(f.torsoX + (tx - left + (sx + 0.5) / SS) * F);
      const y = Math.floor(f.feet + (ty - up + (sy + 0.5) / SS) * F);
      n++;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (sh.owner[i] !== f.idx) continue;
      as += alpha[i]; gs += alpha[i] * toned(sh, gray[i]);
    }
    const a = as / n, g = as > 0 ? gs / as : 0;
    const o = (ty * w + tx) * 4;
    // traços brancos finos (rastros, faíscas) sobrevivem com cobertura menor
    if (a >= 0.42 || (g > 170 && a >= 0.26)) {
      const q = centers[nearestIdx(centers, g)];
      px[o] = px[o + 1] = px[o + 2] = q; px[o + 3] = 255;
    }
  }
  out.push({ name: f.name, w, h, px, ax: left, ay: up, factor: F });
}

// ------------------------------------------------------------------ quadros derivados
// Os perfis da Tomoe só têm a passada aberta (nenhum quadro com as pernas sob o corpo), o que faz a
// corrida parecer deslizar. O quadro de "passagem" é gerado a partir de um quadro de apoio: do quadril
// para baixo, a silhueta é comprimida em direção ao tronco e deslocada até o pé apoiado ficar sob o corpo.
// Tronco, cabelo e espada ficam intactos.
const DERIVED = [
  { name: 'tmPassR0', from: 'tmC08', hip: 0.5, squeeze: 0.42, shift: -5 },
  { name: 'tmPassR1', from: 'tmD08', hip: 0.5, squeeze: 0.42, shift: -6 },
  { name: 'tmPassL0', from: 'tmC02', hip: 0.5, squeeze: 0.42, shift: 6 },
  { name: 'tmPassL1', from: 'tmD02', hip: 0.5, squeeze: 0.42, shift: 7 },
];
for (const d of DERIVED) {
  const src = out.find(f => f.name === d.from);
  if (!src) throw new Error(`derivado ${d.name}: sem ${d.from}`);
  const { w, h, ax, ay } = src;
  const px = new Uint8Array(w * h * 4);
  const hipRow = Math.round(ay * d.hip);
  for (let y = 0; y < h; y++) {
    // 0 no quadril, 1 no pé (ease-in para a dobra da cintura não aparecer)
    const t = y <= hipRow ? 0 : Math.min(1, (y - hipRow) / Math.max(1, ay - hipRow));
    const k = t * t * (3 - 2 * t);
    const sx = 1 - (1 - d.squeeze) * k, dx = d.shift * k;
    for (let x = 0; x < w; x++) {
      const srcX = Math.round(ax + (x - ax - dx) / sx);
      if (srcX < 0 || srcX >= w) continue;
      const a = (y * w + srcX) * 4, b = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) px[b + c] = src.px[a + c];
    }
  }
  out.push({ name: d.name, w, h, px, ax, ay, factor: src.factor, from: d.from });
}

// ------------------------------------------------------------------ atlas (prateleiras)
const PAD = 2, MAXW = 2048;
const order = [...out].sort((a, b) => b.h - a.h);
let x = PAD, y = PAD, shelfH = 0, AW = 0;
for (const f of order) {
  if (x + f.w + PAD > MAXW) { x = PAD; y += shelfH + PAD; shelfH = 0; }
  f.ox = x; f.oy = y;
  x += f.w + PAD; shelfH = Math.max(shelfH, f.h); AW = Math.max(AW, x);
}
const AH = y + shelfH + PAD;
const atlas = new PNG({ width: AW, height: AH });
atlas.data.fill(0);
const meta = { sources: SHEETS.map(s => s.file), stand: STAND, width: AW, height: AH, palette: centers, frames: {} };
for (const f of out) {
  for (let yy = 0; yy < f.h; yy++) for (let xx = 0; xx < f.w; xx++) {
    const s = (yy * f.w + xx) * 4, d = ((f.oy + yy) * AW + f.ox + xx) * 4;
    for (let k = 0; k < 4; k++) atlas.data[d + k] = f.px[s + k];
  }
}
for (const f of out) meta.frames[f.name] = { x: f.ox, y: f.oy, w: f.w, h: f.h, ax: f.ax, ay: f.ay, ...(f.from ? { from: f.from } : {}) };
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'samurai.png'), PNG.sync.write(atlas));
fs.writeFileSync(path.join(OUT_DIR, 'samurai.json'), JSON.stringify(meta, null, 1) + '\n');

// ------------------------------------------------------------------ prévia: quadros na ordem das folhas, pé na mesma linha
const Z = 3, CELL_W = Math.max(...out.map(f => f.w)) + 6, BASE = Math.max(...out.map(f => f.ay)) + 4;
const CELL_H = BASE + Math.max(...out.map(f => f.h - f.ay)) + 4;
const perRow = 9, nRows = Math.ceil(out.length / perRow);
const PW = perRow * CELL_W * Z, PH = nRows * CELL_H * Z;
const prev = new PNG({ width: PW, height: PH });
for (let i = 0; i < PW * PH; i++) { prev.data[i * 4] = prev.data[i * 4 + 1] = prev.data[i * 4 + 2] = 150; prev.data[i * 4 + 3] = 255; }
out.forEach((f, k) => {
  const cx = (k % perRow) * CELL_W + (CELL_W >> 1), cy = Math.floor(k / perRow) * CELL_H + BASE;
  for (let yy = 0; yy < f.h; yy++) for (let xx = 0; xx < f.w; xx++) {
    const s = (yy * f.w + xx) * 4;
    if (f.px[s + 3] === 0) continue;
    const X = cx - f.ax + xx, Y = cy - f.ay + yy;
    for (let zy = 0; zy < Z; zy++) for (let zx = 0; zx < Z; zx++) {
      const d = (((Y * Z + zy) * PW) + X * Z + zx) * 4;
      prev.data[d] = prev.data[d + 1] = prev.data[d + 2] = f.px[s];
    }
  }
  // linha do chão (vermelha) e marca da âncora
  for (let xx = -(CELL_W >> 1) + 2; xx < (CELL_W >> 1) - 2; xx++) {
    const d = ((cy * Z) * PW + (cx + xx) * Z) * 4; prev.data[d] = 255; prev.data[d + 1] = 60; prev.data[d + 2] = 60;
  }
  for (let yy = -3; yy <= 0; yy++) { const d = (((cy + yy) * Z) * PW + cx * Z) * 4; prev.data[d] = 255; prev.data[d + 1] = 60; prev.data[d + 2] = 60; }
});
fs.mkdirSync(path.join(ROOT, 'assets-src/preview'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'assets-src/preview/atlas-frames.png'), PNG.sync.write(prev));

console.log(`atlas ${AW}x${AH}, ${out.length} quadros, paleta ${centers.join(',')}, tom ${sheets.map(s => s.toneMul.toFixed(2)).join('/')}`);
for (const f of out) console.log(`  ${f.name.padEnd(13)} ${String(f.w).padStart(3)}x${String(f.h).padEnd(3)} âncora (${f.ax}, ${f.ay}) fator ${f.factor.toFixed(2)}`);
