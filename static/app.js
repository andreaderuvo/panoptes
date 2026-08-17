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
let token = localStorage.getItem(KEY) || '';

// The bar at the top of a phone matches the page rather than staying dark over a light
// one. Argus does the same; two windows of the same thing should not disagree.
document.querySelector('meta[name=theme-color]')?.setAttribute(
  'content', document.documentElement.dataset.theme === 'light' ? '#ffffff' : '#0b0e14',
);

/** Somewhere to put the token when you did not arrive by link.
 *
 *  The message used to say the address needed one and then offer nowhere to type it, which
 *  is a door with a sign on it and no handle. It happens more than it sounds: a browser
 *  keeps its keys per origin, so reaching the same board by name after having reached it
 *  by address is arriving somewhere new.
 */
function askForToken(why) {
  const field = el('input', {
    type: 'password', className: 'tokenbox', placeholder: 'token',
    autocomplete: 'off', spellcheck: false,
  });
  const go = el('button', { className: 'primary', textContent: 'Open' });
  const form = el('form', { className: 'askbox' }, [
    el('p', { textContent: why }),
    el('div', { className: 'askrow' }, [field, go]),
  ]);
  form.onsubmit = (e) => {
    e.preventDefault();
    const given = field.value.trim();
    if (!given) return;
    localStorage.setItem(KEY, given);
    token = given;
    draw();
  };
  board.replaceChildren(form);
  field.focus();
}

/* A colour per machine, derived from its name.
 *
 *  Argus's own palette and Argus's own arithmetic, so a machine wears the same colour here
 *  as its sessions wear there, and nobody configures anything: the same name gives the
 *  same colour on every device, for ever, which a stored preference cannot promise.
 */
const MACHINE_COLOURS = [
  '#e5786d', '#d6a25f', '#9fd66f', '#5fc9a3',
  '#6fc7d6', '#7aa2d6', '#b98fd6', '#d66fa8',
];

function colourFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MACHINE_COLOURS[h % MACHINE_COLOURS.length];
}

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
  // Straight to that terminal, not merely to the machine it is on. The card already does
  // the machine; a chip that did the same thing would be a second button for one job.
  const chip = el('a', {
    className: `chip${why ? ` chip-${why}` : ''}`,
    href: `${url}/#/term?s=${encodeURIComponent(session.name)}`,
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
    el('span', { className: 'mark', 'aria-hidden': 'true' }),
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
  const card = el('article', {
    className: `card${wants ? ' wants' : ''}${machine.ok ? '' : ' cold'}${machine.url ? ' open' : ''}`,
  }, [head, body, foot]);
  // Down the left edge, which is also where "this one wants you" is said — so a machine
  // asking for you overrides its own colour rather than competing with it.
  card.style.setProperty('--mc', colourFor(machine.name));

  /* The whole tile opens the machine.
   *
   *  A card is one thing and reads as one thing, so it should behave as one: a small
   *  target inside a large obviously-clickable rectangle is a target people miss. The
   *  chips and the name keep their own destinations — a click that landed on one of them
   *  was meant for it — and the name stays a real link so middle-click and copy-address
   *  still work.
   */
  if (machine.url) {
    const go = () => window.open(machine.url, '_blank', 'noopener');
    card.addEventListener('click', (e) => { if (!e.target.closest('a')) go(); });
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      go();
    });
  }
  return card;
}

async function draw() {
  let answer;
  try {
    const r = await fetch('/api/board', { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) {
      askForToken(token ? 'That token was refused.' : 'This board needs its token.');
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
