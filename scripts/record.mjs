// Record the clip the board is shown with.
//
// A scene is a list of steps: something to do, and how long to hold afterwards. The page is
// driven through the debugging protocol rather than by hand, so the clip can be made again
// after the interface moves — which is the only way it stays true.
//
//   node scripts/record.mjs --list
//   node scripts/record.mjs board
//
// Wants: the demo board (python3 scripts/demo.py) and a Chromium listening for the debugger
// on 9333. Frames come out of the browser's own screencast, each with the moment it was
// painted, so the timing in the file is the timing that happened.
//
// One step type is the board's own: `announce` posts a machine's report exactly as a real
// machine would. That is the difference between a clip and a screenshot here — a board's
// whole job is to change when something happens on a machine you are not looking at, and
// that is a thing only a moving picture can show.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const DEBUGGER = process.env.PANOPTES_CDP || 'http://127.0.0.1:9333';
const BOARD = process.env.PANOPTES_DEMO || 'http://127.0.0.1:8770';
const TOKEN = process.env.PANOPTES_TOKEN || 'demo-board-token-not-a-secret-0001';
const REGISTER = process.env.PANOPTES_REGISTER || 'demo-register-token-not-a-secret-01';
const OUT = process.env.PANOPTES_CLIPS || '/tmp/panoptes-clips';
const FFMPEG = [`${homedir()}/miniconda3/envs/argus-video/bin/ffmpeg`, 'ffmpeg']
  .find((p) => p === 'ffmpeg' || existsSync(p));

const WIDE = { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false };

const DAY = 86400;
const HOUR = 3600;

/* ------------------------------------------------------------------ the browser */

const cdp = async () => {
  const pages = await (await fetch(`${DEBUGGER}/json/list`)).json();
  const target = pages.find((t) => t.type === 'page');
  if (!target) throw new Error('no page to drive');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    else if (m.method) listeners.forEach((fn) => fn(m));
  };
  await new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((res) => {
    pending.set(++id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A machine calling in, the way a real one does. */
const announce = async (body) => {
  const answer = await fetch(`${BOARD}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${REGISTER}` },
    body: JSON.stringify(body),
  });
  if (!answer.ok) throw new Error(`${body.name}: the board refused the report — ${answer.status}`);
};

/* -------------------------------------------------------------------- the scenes */

// `brick` is the machine that changes its mind mid-clip: it is announced working, and then
// announced again with its agent asking. Everything else about it stays as demo.py had it,
// so the tile that moves is the same tile.
const BRICK = {
  name: 'brick',
  reach: 'http://brick.example:8090',
  hostname: 'brick',
  uptime: 88 * DAY,
  serving: 88 * DAY,
  cores: 32,
  load: [11.4, 10.9, 9.8],
  load_pct: 36.0,
  memory_pct: 83.0,
  swap_pct: 12.0,
  disk: { path: '/scratch', pct: 74.0, level: 'high' },
  sessions: [
    { name: 'train', bell: null, windows: 2, attached: true },
    { name: 'tensorboard', bell: null, windows: 1, attached: false },
    { name: 'claude', bell: null, windows: 5, attached: false },
    { name: 'shell', bell: null, windows: 1, attached: false },
  ],
};

// Every name demo.py invents. Anything else on the board is a real machine and stops the
// recording — see the check in record().
const FLEET_NAMES = ['vaporwave', 'tinderbox', 'old-faithful', 'brick', 'lighthouse', 'shed'];

const asking = (machine, session) => ({
  ...machine,
  sessions: machine.sessions.map((s) => (s.name === session ? { ...s, bell: 'asking' } : s)),
});

// Each step: what it does, and how long the finished picture is held. The holds are what
// makes a clip readable — an interface that never rests reads as a glitch.
const SCENES = {
  board: {
    title: 'Six machines, and the one that wants you',
    size: WIDE,
    steps: [
      { hold: 1600 },
      { say: 'Every machine you run agents on. One page.', hold: 2600 },
      { say: 'vaporwave is asking you something — top of the board, and the only tile in the accent.', hold: 3000 },
      { say: 'old-faithful is at 96% on /var/lib/archive. shed has stopped calling in.', hold: 3000 },
      { say: '', hold: 400 },
      // The moment the board exists for.
      { announce: () => asking(BRICK, 'claude'), hold: 7000 },
      { say: 'brick’s agent has just stopped and asked. Nobody was watching brick.', hold: 3000 },
      { say: 'Two, now — and both of them came to the top on their own.', hold: 2800 },
      { hover: '.card .chips a', hold: 1600 },
      { say: 'Click the session and that terminal opens: its own machine, its own token.', hold: 2800 },
      { say: '', hold: 900 },
      // Put it back, so the next recording starts from the same board.
      { announce: () => BRICK, hold: 600 },
    ],
  },
};

/* ------------------------------------------------------------------- recording */

async function record(name) {
  const scene = SCENES[name];
  if (!scene) throw new Error(`no scene called ${name}`);
  const dir = `${OUT}/${name}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const { send, on, close } = await cdp();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', scene.size);

  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) return `ERR ${(r.exceptionDetails.exception?.description || '').slice(0, 200)}`;
    return r?.result?.value;
  };

  await send('Page.navigate', { url: 'about:blank' });
  await wait(300);
  await send('Page.navigate', { url: `${BOARD}/?token=${TOKEN}` });
  await wait(5000);

  /* Refuse to record the wrong board.
   *
   *  Two ways it can be wrong, and the second one matters far more. A board with two tiles on
   *  it has not been filled, and a clip of that is worse than no clip. A board with a *real*
   *  machine on it publishes that machine's name, its sessions and how full its disks are —
   *  and it happens by accident, because a board is a thing you leave running on a port and
   *  `demo.py` will happily fill whichever one answers. It happened here: a clip was recorded,
   *  reviewed frame by frame, and thrown away because somebody's own machine was in it.
   *
   *  So the names on screen have to be the invented ones, every one of them, or nothing is
   *  recorded. Use --port on both demo.py and PANOPTES_DEMO to keep away from a board you
   *  already run.
   */
  const names = await ev(`[...document.querySelectorAll('.card .name')].map(n => n.textContent.trim())`);
  const invented = new Set([...FLEET_NAMES]);
  const strangers = (names || []).filter((n) => !invented.has(n));
  if (strangers.length) {
    throw new Error(`${name}: this board has machines that demo.py did not invent — ${strangers.join(', ')}. `
      + 'That is somebody\'s real fleet: record against a board of your own (demo.py --port N, PANOPTES_DEMO).');
  }
  if ((names || []).length < 6) throw new Error(`${name}: ${(names || []).length} tiles on the board — run scripts/demo.py first`);

  // The caption lives in the page, so it is recorded with everything else rather than burned
  // in afterwards by a filter nobody can read.
  await ev(`(() => {
    const s = document.createElement('style');
    s.textContent = '#shotsay{position:fixed;left:50%;bottom:5%;transform:translateX(-50%);z-index:99999;'
      + 'background:rgba(11,14,20,.92);color:#e6e9ef;border:1px solid #1e2530;border-radius:.6rem;'
      + 'padding:.6rem 1rem;font:500 15px/1.4 system-ui,sans-serif;max-width:80%;text-align:center;'
      + 'opacity:0;transition:opacity .25s;pointer-events:none}#shotsay.on{opacity:1}';
    document.head.append(s);
    const n = document.createElement('div');
    n.id = 'shotsay';
    document.body.append(n);
    window.__say = (t) => { n.textContent = t; n.classList.toggle('on', !!t); };
  })()`);

  /* Holding an announced state against the thing that keeps refreshing it.
   *
   *  demo.py re-announces the whole fleet every eight seconds, so the board never goes stale
   *  during a long take — and its copy of `brick` says the agent is not asking. A single
   *  report was therefore undone within a few seconds, which is exactly what the first
   *  recording showed: the tile that was supposed to change never did. So whatever an
   *  `announce` step asked for is re-posted until the next one asks for something else.
   */
  let holding = null;
  const keeping = setInterval(() => { if (holding) announce(holding).catch(() => {}); }, 2000);

  const frames = [];
  on((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    frames.push({ data: m.params.data, at: m.params.metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  });
  await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

  for (const step of scene.steps) {
    if (step.announce) {
      holding = step.announce();
      await announce(holding);
    }
    if (step.click) await ev(`document.querySelector(${JSON.stringify(step.click)})?.click()`);
    if (step.hover) {
      const spot = await ev(`(() => {
        const n = document.querySelector(${JSON.stringify(step.hover)});
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
      })()`);
      if (spot?.x) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spot.x, y: spot.y });
      else console.log(`    (${name}: nothing to hover at ${step.hover})`);
    }
    if (step.away) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    if (step.say !== undefined) await ev(`window.__say(${JSON.stringify(step.say)})`);
    await wait(step.hold ?? 1000);
    if (step.say) await ev(`window.__say('')`);
  }
  await send('Page.stopScreencast');
  clearInterval(keeping);
  await wait(400);
  close();

  if (!frames.length) throw new Error('the screencast produced nothing');

  // Real timings: each frame is held until the next one was painted.
  const list = [];
  for (let i = 0; i < frames.length; i += 1) {
    const file = `${dir}/f${String(i).padStart(5, '0')}.png`;
    await writeFile(file, Buffer.from(frames[i].data, 'base64'));
    const next = frames[i + 1]?.at ?? frames[i].at + 0.08;
    list.push(`file '${file}'`, `duration ${Math.max(0.02, next - frames[i].at).toFixed(3)}`);
  }
  list.push(`file '${dir}/f${String(frames.length - 1).padStart(5, '0')}.png'`);
  await writeFile(`${dir}/frames.txt`, `${list.join('\n')}\n`);

  const seconds = (frames.at(-1).at - frames[0].at).toFixed(1);
  await assemble(dir, name);
  console.log(`  ${name}: ${frames.length} frames, ${seconds}s -> ${OUT}/${name}.mp4 and .gif`);
}

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => (code === 0 ? res() : rej(new Error(err.slice(-500)))));
});

async function assemble(dir, name) {
  if (!FFMPEG) throw new Error('no ffmpeg — conda create -n argus-video -c conda-forge ffmpeg');
  // yuv420p and an even size, or half the players in the world show nothing.
  const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/frames.txt`,
    '-vf', `${even},fps=30`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${name}.mp4`]);
  // A palette of its own, because a dark interface through the default 216 colours bands
  // into something that looks broken.
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', `${dir}/frames.txt`,
    '-vf', `${even},fps=12,scale=900:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    `${OUT}/${name}.gif`]);
}

/* ------------------------------------------------------------------------ main */

const args = process.argv.slice(2);
if (!args.length || args[0] === '--list') {
  console.log('scenes:');
  for (const [key, s] of Object.entries(SCENES)) console.log(`  ${key.padEnd(8)} ${s.title}`);
  process.exit(0);
}
await mkdir(OUT, { recursive: true });
for (const name of args[0] === 'all' ? Object.keys(SCENES) : args) {
  await record(name);
}
process.exit(0);
