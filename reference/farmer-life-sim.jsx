import React, { useState } from "react";
import { Heart, BookOpen, X } from "lucide-react";

const TILE_W = 64;
const TILE_H = 32;
const GRID_SIZE = 9;
const OFFSET_X = 310;
const OFFSET_Y = 70;

const MAP_ROWS = [
  "TTTTTTTTT",
  "TGGPGGAGT",
  "TGFFFGGGT",
  "TGFFFPGGT",
  "TPPPPPPPT",
  "TGGWWGBGT",
  "TGGWWGGGT",
  "TGGGPGGGT",
  "TTTTTTTTT",
];

const WALKABLE = new Set(["G", "P", "F"]);

const BASE_COLORS = {
  T: "#6f8f56",
  G: "#7c9459",
  G2: "#87a065",
  P: "#d9c9a3",
  F: "#8b5e3c",
  W: "#6c93a6",
  A: "#7c9459",
  B: "#7c9459",
};

const TIER_LABELS = ["よそよそしい", "顔見知り", "親しい", "信頼している"];

const NPC_SEED = [
  {
    id: "saburo",
    name: "三郎じい",
    x: 5,
    y: 1,
    body: "#5b4636",
    accent: "#b5453a",
    skin: "#e3bd93",
    hair: "#d8d3c4",
    first: "おお、見ない顔じゃな。儂は三郎、この村で一番長く鍬を握っとる年寄りよ。",
    greet: [
      "精が出るのう。今日も畑はよう育っとる。",
      "お前さんも大分、村に馴染んできたようじゃな。",
      "ふぉっふぉ、儂に会いに来てくれるとは嬉しいもんじゃ。",
      "儂の知る限りの畑仕事、いつでも教えてやるぞ。",
    ],
    ignore: ["……忙しいのか。まあ、急ぐ旅でもあるまいて。", "若いもんは前を向いておればええ。"],
  },
  {
    id: "okinu",
    name: "おきぬ",
    x: 5,
    y: 5,
    body: "#7a5c8e",
    accent: "#c98a9c",
    skin: "#eccdaa",
    hair: "#3a2e22",
    first: "あ……こんにちは。わたし、機織りのおきぬです。急に声をかけられると驚いてしまって。",
    greet: [
      "あ、また会いましたね。今日の糸はうまく紡げそうです。",
      "こうして顔を合わせるの、なんだか嬉しいです。",
      "あなたが来ると、なぜか手が軽くなる気がします。",
      "いつも気にかけてくれて……ありがとうございます。",
    ],
    ignore: ["……あ、そうですよね、お忙しいですよね。", "……(小さく会釈するだけだった)"],
  },
  {
    id: "taro",
    name: "たろう",
    x: 1,
    y: 7,
    body: "#3f6b8c",
    accent: "#e0a63a",
    skin: "#f0d0a8",
    hair: "#2b2117",
    first: "わあ、はじめて見る顔だ!ねえねえ、どこから来たの?",
    greet: [
      "また来た!今日はカエル見つけたんだ、見る?",
      "また遊ぼうよ!",
      "もう、あんたのこと友達だと思ってるからな!",
      "たろう、大きくなったらあんたみたいになりたいな。",
    ],
    ignore: ["……ちぇ、無視すんなよ。", "……(しょんぼりして地面をつつく)"],
  },
];

function cellType(x, y) {
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return "T";
  return MAP_ROWS[y][x];
}

function toScreen(x, y) {
  return { sx: (x - y) * (TILE_W / 2) + OFFSET_X, sy: (x + y) * (TILE_H / 2) + OFFSET_Y };
}

function footPoint(x, y) {
  const { sx, sy } = toScreen(x, y);
  return { sx, sy: sy + TILE_H };
}

function getTier(affinity) {
  if (affinity >= 75) return 3;
  if (affinity >= 50) return 2;
  if (affinity >= 25) return 1;
  return 0;
}

function bfsPath(start, isGoal, walkable) {
  if (isGoal(start.x, start.y)) return [];
  const key = (x, y) => x + "," + y;
  const visited = new Set([key(start.x, start.y)]);
  const queue = [{ x: start.x, y: start.y, path: [] }];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      if (!walkable(nx, ny)) continue;
      const newPath = [...cur.path, { x: nx, y: ny }];
      if (isGoal(nx, ny)) return newPath;
      visited.add(k);
      queue.push({ x: nx, y: ny, path: newPath });
    }
  }
  return null;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function TileBase({ x, y, sx, sy, onClick, clickable }) {
  const type = cellType(x, y);
  let fill = BASE_COLORS[type];
  if (type === "G" && (x + y) % 2 === 0) fill = BASE_COLORS.G2;
  const points = `${sx},${sy} ${sx + TILE_W / 2},${sy + TILE_H / 2} ${sx},${sy + TILE_H} ${sx - TILE_W / 2},${sy + TILE_H / 2}`;
  return (
    <g onClick={clickable ? onClick : undefined} style={{ cursor: clickable ? "pointer" : "default" }}>
      <polygon points={points} fill={fill} stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
      {type === "F" && (
        <>
          <line x1={sx - 16} y1={sy + 12} x2={sx + 4} y2={sy + 20} stroke="#6e4a2d" strokeWidth="2" opacity="0.6" />
          <line x1={sx - 4} y1={sy + 8} x2={sx + 16} y2={sy + 16} stroke="#6e4a2d" strokeWidth="2" opacity="0.6" />
        </>
      )}
      {type === "W" && <ellipse cx={sx} cy={sy + 16} rx="18" ry="7" fill="#9dc0cc" opacity="0.5" />}
    </g>
  );
}

function CubeFaces({ sx, sy, h, top, left, right }) {
  const topPts = `${sx},${sy - h} ${sx + TILE_W / 2},${sy + TILE_H / 2 - h} ${sx},${sy + TILE_H - h} ${sx - TILE_W / 2},${sy + TILE_H / 2 - h}`;
  const leftPts = `${sx - TILE_W / 2},${sy + TILE_H / 2 - h} ${sx},${sy + TILE_H - h} ${sx},${sy + TILE_H} ${sx - TILE_W / 2},${sy + TILE_H / 2}`;
  const rightPts = `${sx},${sy + TILE_H - h} ${sx + TILE_W / 2},${sy + TILE_H / 2 - h} ${sx + TILE_W / 2},${sy + TILE_H / 2} ${sx},${sy + TILE_H}`;
  return (
    <>
      <polygon points={leftPts} fill={left} />
      <polygon points={rightPts} fill={right} />
      <polygon points={topPts} fill={top} stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
    </>
  );
}

function TreeDeco({ sx, sy }) {
  const baseY = sy + TILE_H;
  return (
    <g>
      <ellipse cx={sx} cy={baseY} rx="15" ry="5" fill="black" opacity="0.18" />
      <rect x={sx - 3} y={baseY - 16} width="6" height="16" rx="2" fill="#6e4a2d" />
      <ellipse cx={sx + 3} cy={baseY - 30} rx="19" ry="15" fill="#587a44" />
      <ellipse cx={sx - 4} cy={baseY - 34} rx="17" ry="14" fill="#6c9354" />
    </g>
  );
}

function HouseDeco({ sx, sy, variant }) {
  const roof = variant === "B" ? "#b9835f" : "#c9a66b";
  const wallL = variant === "B" ? "#b3a1a8" : "#b3a488";
  const wallR = variant === "B" ? "#d8c8ce" : "#e8dec9";
  return (
    <g>
      <ellipse cx={sx} cy={sy + TILE_H} rx="26" ry="7" fill="black" opacity="0.18" />
      <CubeFaces sx={sx} sy={sy} h={38} top={roof} left={wallL} right={wallR} />
      <rect x={sx + 6} y={sy + TILE_H - 16} width="8" height="14" fill="#4a3222" />
    </g>
  );
}

function BodySprite({ body, accent, skin, hair, hat }) {
  return (
    <g>
      <ellipse cx="0" cy="0" rx="13" ry="4.5" fill="black" opacity="0.22" />
      <rect x="-9" y="-28" width="18" height="21" rx="7" fill={body} />
      <rect x="-9" y="-20" width="18" height="5" fill={accent} />
      <circle cx="0" cy="-33" r="8.5" fill={skin} />
      {hat ? (
        <>
          <ellipse cx="0" cy="-38" rx="13" ry="3.5" fill={hat} />
          <path d="M -7 -39 Q 0 -50 7 -39 Z" fill={hat} />
        </>
      ) : (
        <path d="M -8 -36 Q 0 -43 8 -36 Z" fill={hair} />
      )}
    </g>
  );
}

export default function FarmerLifeSim() {
  const [npcs, setNpcs] = useState(NPC_SEED.map((n) => ({ ...n, affinity: 0, hasMet: false })));
  const [farmer, setFarmer] = useState({ x: 4, y: 4 });
  const [farmerPixel, setFarmerPixel] = useState(null);
  const [farmerDepth, setFarmerDepth] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [dialogue, setDialogue] = useState(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [debugSlow, setDebugSlow] = useState(false);

  const isBlocked = (x, y) => !WALKABLE.has(cellType(x, y)) || npcs.some((n) => n.x === x && n.y === y);

  function openDialogue(npcId) {
    const npc = npcs.find((n) => n.id === npcId);
    if (!npc) return;
    const promptText = npc.hasMet ? `${npc.name}があなたに気づいた。` : npc.first;
    setDialogue({ npcId, stage: "prompt", text: promptText });
    setNpcs((prev) => prev.map((n) => (n.id === npcId ? { ...n, hasMet: true } : n)));
  }

  function animateStep(from, to, duration, fromGrid, toGrid) {
    return new Promise((resolve) => {
      const start = performance.now();
      const stepDepth = Math.max(fromGrid.x + fromGrid.y, toGrid.x + toGrid.y);
      setFarmerDepth(stepDepth);
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        setFarmerPixel({ sx: from.sx + (to.sx - from.sx) * ease, sy: from.sy + (to.sy - from.sy) * ease });
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  async function runMovement(path, onArrive) {
    setIsMoving(true);
    let currentGrid = farmer;
    let current = footPoint(farmer.x, farmer.y);
    for (const step of path) {
      const target = footPoint(step.x, step.y);
      await animateStep(current, target, debugSlow ? 2500 : 320, currentGrid, step);
      current = target;
      currentGrid = step;
      setFarmer(step);
    }
    setFarmerPixel(null);
    setFarmerDepth(null);
    setIsMoving(false);
    if (onArrive) onArrive();
  }

  function handleTileClick(tx, ty) {
    if (isMoving || dialogue) return;
    const npc = npcs.find((n) => n.x === tx && n.y === ty);
    let goalFn;
    let targetNpcId = null;
    if (npc) {
      targetNpcId = npc.id;
      goalFn = (x, y) => Math.abs(x - npc.x) + Math.abs(y - npc.y) === 1 && !isBlocked(x, y);
    } else {
      if (!WALKABLE.has(cellType(tx, ty))) return;
      if (farmer.x === tx && farmer.y === ty) return;
      goalFn = (x, y) => x === tx && y === ty;
    }
    const path = bfsPath(farmer, goalFn, (x, y) => !isBlocked(x, y));
    if (!path) return;
    if (path.length === 0) {
      if (targetNpcId) openDialogue(targetNpcId);
      return;
    }
    runMovement(path, () => {
      if (targetNpcId) openDialogue(targetNpcId);
    });
  }

  function handleGreet() {
    if (!dialogue) return;
    const npc = npcs.find((n) => n.id === dialogue.npcId);
    if (!npc) return;
    const tier = getTier(npc.affinity);
    const responseText = npc.greet[tier];
    const delta = [10, 7, 4, 2][tier];
    const newAffinity = Math.min(100, npc.affinity + delta);
    const newTier = getTier(newAffinity);
    setDialogue({
      npcId: npc.id,
      stage: "response",
      text: responseText,
      delta,
      tierChanged: newTier !== tier,
      newTierLabel: TIER_LABELS[newTier],
    });
    setNpcs((prev) => prev.map((n) => (n.id === npc.id ? { ...n, affinity: newAffinity } : n)));
  }

  function handleIgnore() {
    if (!dialogue) return;
    const npc = npcs.find((n) => n.id === dialogue.npcId);
    if (!npc) return;
    const line = npc.ignore[Math.floor(Math.random() * npc.ignore.length)];
    const newAffinity = Math.max(0, npc.affinity - 3);
    setDialogue({ npcId: npc.id, stage: "response", text: line, delta: -3, tierChanged: false });
    setNpcs((prev) => prev.map((n) => (n.id === npc.id ? { ...n, affinity: newAffinity } : n)));
  }

  const entities = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      entities.push({ kind: "tile", x, y, depth: x + y });
    }
  }
  npcs.forEach((n) => entities.push({ kind: "npc", npc: n, x: n.x, y: n.y, depth: n.x + n.y + 0.4 }));
  entities.push({ kind: "farmer", x: farmer.x, y: farmer.y, depth: (farmerDepth !== null ? farmerDepth : farmer.x + farmer.y) + 0.5 });
  entities.sort((a, b) => a.depth - b.depth);

  const activeNpc = dialogue ? npcs.find((n) => n.id === dialogue.npcId) : null;

  return (
    <div className="fls-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Yuji+Syuku&family=Zen+Maru+Gothic:wght@400;700&display=swap');
        .fls-root { min-height: 100vh; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding: 24px 12px; background: radial-gradient(ellipse at center, #efe6d3 0%, #ddd0b2 60%, #cabd9a 100%); font-family: 'Zen Maru Gothic', sans-serif; position:relative; overflow:hidden; }
        .fls-title { font-family: 'Yuji Syuku', serif; font-size: 30px; color:#3a2e22; letter-spacing:2px; text-shadow: 0 1px 0 rgba(255,255,255,0.4); }
        .fls-sub { font-size:12px; color:#6b5c47; margin-top:-8px; }
        .fls-inner { position:relative; border-radius: 14px; overflow:hidden; background: linear-gradient(180deg,#cfe3d8,#e9dfc4); box-shadow: 0 18px 40px rgba(0,0,0,0.3), 0 0 0 6px #6b4a30, 0 0 0 8px #8c6239; }
        .fls-caption { font-size:12px; color:#5b4a38; max-width: 580px; text-align:center; line-height:1.6; }
        @keyframes flsBob { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-3px);} }
        .fls-walk { animation: flsBob 0.26s ease-in-out infinite; }
        .fls-npc-idle { animation: flsIdle 2.6s ease-in-out infinite; }
        @keyframes flsIdle { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-1.5px);} }
        .fls-dialogue { position:absolute; left:10px; right:10px; bottom:10px; background: linear-gradient(180deg,#fbf4e2,#f0e4c4); border: 2px solid #33465b; border-radius: 12px; padding: 12px 14px; box-shadow: 0 8px 20px rgba(0,0,0,0.3); }
        .fls-dname { font-weight:700; color:#33465b; font-size:13px; margin-bottom:4px; }
        .fls-dtext { font-size:13px; color:#3a2e22; line-height:1.6; min-height: 36px; }
        .fls-dbtns { display:flex; gap:8px; margin-top:10px; }
        .fls-btn { flex:1; border:none; border-radius:8px; padding:8px 10px; font-family:'Zen Maru Gothic',sans-serif; font-size:13px; cursor:pointer; font-weight:700; }
        .fls-btn-greet { background:#33465b; color:#f0e4c4; }
        .fls-btn-ignore { background:#e5d9b8; color:#5b4a38; }
        .fls-btn-close { background:#b5453a; color:#fbf4e2; }
        .fls-chip { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; margin-left:6px; }
        .fls-chip-pos { background:#f3d9d5; color:#b5453a; }
        .fls-chip-neg { background:#e4e0d6; color:#6b5c47; }
        .fls-notebook-btn { position:absolute; top:10px; right:10px; background:#33465b; color:#f0e4c4; border:none; border-radius:8px; padding:6px 8px; cursor:pointer; display:flex; align-items:center; gap:4px; font-size:11px; z-index:5; }
        .fls-notebook { position:absolute; top:44px; right:10px; width:190px; background:#fbf4e2; border:2px solid #33465b; border-radius:10px; padding:10px; box-shadow:0 8px 20px rgba(0,0,0,0.3); z-index:5; }
        .fls-nb-row { display:flex; align-items:center; justify-content:space-between; font-size:12px; color:#3a2e22; padding:4px 0; border-bottom: 1px dashed #cdbf9a; }
        .fls-nb-row:last-child { border-bottom:none; }
        .fls-hearts { display:flex; gap:1px; }
      `}</style>

      <div className="fls-title">箱庭農民記</div>
      <div className="fls-sub">〜ある農民の一日〜</div>

      <div className="fls-inner" style={{ width: 620, maxWidth: "88vw" }}>
          <button className="fls-notebook-btn" onClick={() => setNotebookOpen((v) => !v)}>
            <BookOpen size={14} /> 村人手帳
          </button>
          {notebookOpen && (
            <div className="fls-notebook">
              {npcs.map((n) => {
                const tier = getTier(n.affinity);
                return (
                  <div className="fls-nb-row" key={n.id}>
                    <span>{n.hasMet ? n.name : "？？？"}</span>
                    {n.hasMet ? (
                      <span className="fls-hearts">
                        {[0, 1, 2, 3].map((i) => (
                          <Heart key={i} size={11} fill={i <= tier ? "#b5453a" : "none"} color="#b5453a" />
                        ))}
                      </span>
                    ) : (
                      <span style={{ color: "#a99b7d" }}>未接触</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <svg viewBox="0 0 620 430" style={{ width: "100%", height: "auto", display: "block" }}>
            <defs>
              <radialGradient id="flsVignette" cx="50%" cy="46%" r="65%">
                <stop offset="60%" stopColor="#000000" stopOpacity="0" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
              </radialGradient>
            </defs>
            <rect x="0" y="0" width="620" height="430" fill="url(#flsVignette)" pointerEvents="none" />
            {entities.map((e, i) => {
              if (e.kind === "tile") {
                const { sx, sy } = toScreen(e.x, e.y);
                const type = cellType(e.x, e.y);
                return (
                  <g key={i}>
                    <TileBase x={e.x} y={e.y} sx={sx} sy={sy} clickable={WALKABLE.has(type)} onClick={() => handleTileClick(e.x, e.y)} />
                    {type === "T" && <TreeDeco sx={sx} sy={sy} />}
                    {(type === "A" || type === "B") && <HouseDeco sx={sx} sy={sy} variant={type} />}
                  </g>
                );
              }
              if (e.kind === "npc") {
                const { sx, sy } = toScreen(e.x, e.y);
                const n = e.npc;
                return (
                  <g key={i} transform={`translate(${sx},${sy + TILE_H})`} style={{ cursor: "pointer" }} onClick={() => handleTileClick(e.x, e.y)}>
                    <g className="fls-npc-idle">
                      <BodySprite body={n.body} accent={n.accent} skin={n.skin} hair={n.hair} hat={false} />
                    </g>
                  </g>
                );
              }
              const pos = farmerPixel || footPoint(e.x, e.y);
              return (
                <g key={i} transform={`translate(${pos.sx},${pos.sy})`}>
                  <g className={isMoving ? "fls-walk" : undefined}>
                    <BodySprite body="#3f5b3a" accent="#8a5a2e" skin="#e8c9a0" hair="#2b2117" hat="#d8b978" />
                  </g>
                </g>
              );
            })}
          </svg>
          {dialogue && activeNpc && (
            <div className="fls-dialogue">
              <div className="fls-dname">{activeNpc.name}</div>
              <div className="fls-dtext">
                {dialogue.text}
                {dialogue.stage === "response" && (
                  <span className={`fls-chip ${dialogue.delta >= 0 ? "fls-chip-pos" : "fls-chip-neg"}`}>
                    好感度 {dialogue.delta >= 0 ? "+" : ""}
                    {dialogue.delta}
                  </span>
                )}
                {dialogue.stage === "response" && dialogue.tierChanged && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#b5453a" }}>◇ 関係が深まった:「{dialogue.newTierLabel}」</div>
                )}
              </div>
              <div className="fls-dbtns">
                {dialogue.stage === "prompt" ? (
                  <>
                    <button className="fls-btn fls-btn-greet" onClick={handleGreet}>
                      挨拶する
                    </button>
                    <button className="fls-btn fls-btn-ignore" onClick={handleIgnore}>
                      挨拶しない
                    </button>
                  </>
                ) : (
                  <button className="fls-btn fls-btn-close" onClick={() => setDialogue(null)}>
                    <X size={12} style={{ display: "inline", marginRight: 4 }} />
                    とじる
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      <div className="fls-caption">
        草地・道・畑のタイルをクリックすると農民が歩いていきます。村人に近づくと会話ができ、「挨拶する」を選ぶと好感度が上がっていきます。
      </div>
      <label style={{ fontSize: 11, color: "#5b4a38", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
        <input type="checkbox" checked={debugSlow} onChange={(e) => setDebugSlow(e.target.checked)} />
        デバッグ: スロー再生(1マス2.5秒。スクリーンショット用)
      </label>
    </div>
  );
}
