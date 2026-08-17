/* The board.
 *
 *  It draws what the server last heard and nothing more. In particular it never receives
 *  a machine's token: clicking through opens that Argus in its own origin, where your
 *  browser already keeps the real one. This page cannot get into anything.
 */

const board = document.getElementById('board');
const swept = document.getElementById('swept');
const count = document.getElementById('count');

/* The board's own token comes in the address, is put away, and is taken out of the bar —
 * so it is not sitting in the history of every phone that has ever opened this. */
const KEY = 'panoptes.token';
const fromBar = new URLSearchParams(location.search).get('token');
if (fromBar) {
  localStorage.setItem(KEY, fromBar);
  history.replaceState(null, '', location.pathname);
}
const token = localStorage.getItem(KEY) || '';

const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
};

const ago = (seconds) => {
  if (seconds == null) return 'never';
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
};

const upFor = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h`;
};

/** A session is worth looking at, or it is not. Only two states earn a colour: one of
 *  them wants you, and one of them has finished. Everything else is quiet on purpose. */
function sessionChip(session, url) {
  const why = session.bell;
  const chip = el('a', {
    className: `chip${why ? ` chip-${why}` : ''}`,
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: why === 'asking' ? 'waiting for you'
      : why === 'done' ? 'finished'
        : session.attached ? 'attached' : 'running',
  });
  chip.append(el('span', { className: 'dot' }));
  chip.append(el('span', { textContent: session.name }));
  if (session.windows > 1) chip.append(el('span', { className: 'dim', textContent: `·${session.windows}` }));
  return chip;
}

function card(machine) {
  const head = el('div', { className: 'cardhead' }, [
    el('a', {
      className: 'name', href: machine.url, target: '_blank', rel: 'noopener noreferrer',
      textContent: machine.name,
    }),
    el('span', { className: 'grow' }),
  ]);

  if (!machine.ok) {
    head.append(el('span', { className: 'state bad', textContent: machine.why || 'unreachable' }));
  } else {
    const load = machine.load_pct ?? 0;
    head.append(el('span', {
      className: `state${load > 90 ? ' warn' : ''}`,
      textContent: `load ${machine.load?.[0] ?? '?'}`,
      title: `${machine.cores} cores · ${machine.load?.join(' ') || ''}`,
    }));
    if (machine.disk) {
      head.append(el('span', {
        className: `state${machine.disk.level === 'critical' ? ' bad' : machine.disk.level === 'high' ? ' warn' : ''}`,
        textContent: `${machine.disk.path} ${Math.round(machine.disk.pct)}%`,
      }));
    }
  }

  const sessions = machine.sessions || [];
  const body = el('div', { className: 'chips' });
  if (sessions.length) {
    for (const s of sessions) body.append(sessionChip(s, machine.url));
  } else if (machine.ok) {
    body.append(el('span', { className: 'dim', textContent: 'no sessions' }));
  }
  // A machine that is down said "nothing listening there" in its header already; the
  // footer says when it last answered. Saying it a third time in the middle is noise.

  const foot = el('div', { className: 'cardfoot dim' }, [
    el('span', {
      textContent: machine.ok && machine.uptime
        ? `up ${upFor(machine.uptime)} · ${Math.round(machine.memory_pct)}% memory`
        : `last answered ${ago(machine.ago)}`,
    }),
  ]);

  const wants = sessions.some((s) => s.bell === 'asking');
  return el('article', { className: `card${wants ? ' wants' : ''}${machine.ok ? '' : ' cold'}` },
    [head, body, foot]);
}

async function draw() {
  let answer;
  try {
    const r = await fetch('/api/board', { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) {
      board.replaceChildren(el('p', { className: 'empty', textContent: 'This board needs its token in the address, once.' }));
      return;
    }
    answer = await r.json();
  } catch {
    swept.textContent = 'cannot reach the board itself';
    return;
  }

  const machines = answer.machines || [];
  board.replaceChildren(...machines.map(card));
  if (!machines.length) {
    board.replaceChildren(el('p', { className: 'empty', textContent: 'No machines yet. Add them to the config and restart.' }));
  }
  const waiting = machines.reduce((n, m) => n + (m.sessions || []).filter((s) => s.bell === 'asking').length, 0);
  count.textContent = `${machines.length} machine${machines.length === 1 ? '' : 's'}`
    + (waiting ? ` · ${waiting} waiting for you` : '');
  swept.textContent = answer.swept ? `swept ${ago((Date.now() / 1000) - answer.swept)}` : 'sweeping…';
  document.title = waiting ? `(${waiting}) Panoptes` : 'Panoptes';
}

/* Full screen, for the board left on a second monitor. Nothing else on the screen is the
 *  point of a board: it is read from across a room. */
const full = document.getElementById('full');
if (full && document.documentElement.requestFullscreen) {
  full.onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => {
    full.title = document.fullscreenElement ? 'Leave full screen' : 'Full screen';
  });
} else if (full) {
  full.hidden = true;      // a browser that will not: no button rather than a dead one
}

draw();
// Slightly slower than the server's own sweep: asking faster than it learns is noise.
setInterval(() => { if (!document.hidden) draw(); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
