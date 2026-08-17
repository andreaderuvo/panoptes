/* The board.
 *
 *  It draws what the server last heard and nothing more. In particular it never receives
 *  a machine's token: clicking through opens that Argus in its own origin, where your
 *  browser already keeps the real one. This page cannot get into anything.
 */

const board = document.getElementById('board');
const swept = document.getElementById('swept');
const count = document.getElementById('count');

/* The board's own token comes in the address, is put away, and is taken out of the bar.
 *
 *  Two forms, and the difference is where they travel. `#token=` is a **fragment**: the
 *  browser never sends it to the server, so it cannot land in an access log, in the log of a
 *  proxy on the way, or in a `Referer`. `?token=` is in the request line and therefore in all
 *  three. The banner prints the hash form; the query form is still accepted, because links
 *  and QR codes already saved on people's phones have to keep working.
 *
 *  Neither saves it from the browser's own history, which is why it is scrubbed from the bar
 *  either way.
 */
const KEY = 'panoptes.token';

function takeTokenFromAddress() {
  const hash = location.hash.replace(/^#/, '');
  const fromHash = new URLSearchParams(hash).get('token');
  const given = fromHash || new URLSearchParams(location.search).get('token');
  if (!given) return false;
  localStorage.setItem(KEY, given);
  const rest = fromHash
    ? hash.split('&').filter((bit) => !bit.startsWith('token=')).join('&')
    : hash;
  history.replaceState(null, '', location.pathname + (rest ? `#${rest}` : ''));
  return true;
}

takeTokenFromAddress();
let token = localStorage.getItem(KEY) || '';

/* And again if one arrives later. Changing only the fragment is a same-document navigation:
 * the browser does not reload, so a `#token=` link pasted into a tab that is already open
 * would otherwise do nothing at all — where `?token=` forces a reload and works. */
window.addEventListener('hashchange', () => {
  if (takeTokenFromAddress()) location.reload();
});

/* ------------------------------------------------------------------- words
 *
 *  Argus's arrangement, kept identical on purpose: the English text is its own key. A
 *  catalogue is then readable by whoever translates it, a missing entry falls back to
 *  English instead of showing a code, and the source keeps saying what it means.
 *
 *  The catalogues are plain files under `static/lang/`, so adding a fifth language is
 *  dropping a file in — no server change, no build step, nothing to register.
 */
let strings = {};
let activeLang = 'en';

function t(text, vars) {
  let out = strings[text] || text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

const LANG = 'panoptes.lang';

/* The list comes from the server, not from a constant here.
 *
 *  Four catalogues ship with the board; a reader can drop a fifth into `<config>/lang/` and
 *  it appears in the picker with nothing else done — no build, no registration, no code. A
 *  hardcoded array here would have made that file loadable and invisible, which is worse
 *  than not supporting it.
 */
let LANGUAGES = [{ code: 'en', name: 'English' }];

async function knownLanguages() {
  try {
    const r = await fetch('/api/languages', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const said = await r.json();
      if (Array.isArray(said) && said.length) LANGUAGES = said;
    }
  } catch { /* the built-in list is a fine answer */ }
  return LANGUAGES;
}

/** Whatever the browser asks for, if we have it — and whatever you chose, over that. */
function preferredLanguage() {
  const mine = localStorage.getItem(LANG);
  if (mine && LANGUAGES.some((l) => l.code === mine)) return mine;
  for (const want of navigator.languages || [navigator.language || 'en']) {
    const code = want.toLowerCase().split('-')[0];
    if (LANGUAGES.some((l) => l.code === code)) return code;
  }
  return 'en';
}

async function loadLanguage(code) {
  activeLang = code || 'en';
  document.documentElement.lang = activeLang;
  if (!code || code === 'en') { strings = {}; return; }
  try {
    const r = await fetch(`/api/language/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    strings = r.ok ? (await r.json()).strings || {} : {};
  } catch { strings = {}; }
}

/* Dark, light, or whatever the machine says.
 *
 *  The page used to replay Argus's stored choice and stop there — which works only if you
 *  have opened Argus on this exact origin, and localStorage is per origin, so on a board at
 *  its own port it never had. It was always dark and there was no way to say otherwise.
 *
 *  Kept in Panoptes' own key, falling back to Argus's when there is one: two windows of the
 *  same thing should agree when they can, and disagreeing is better than one of them being
 *  stuck.
 */
const THEME = 'panoptes.theme';
const THEMES = ['dark', 'light', 'auto'];

function storedTheme() {
  const mine = localStorage.getItem(THEME);
  if (THEMES.includes(mine)) return mine;
  try {
    const theirs = JSON.parse(localStorage.getItem('argus.prefs') || '{}').theme;
    if (THEMES.includes(theirs)) return theirs;
  } catch { /* nothing stored, or nothing readable */ }
  return 'dark';
}

let theme = storedTheme();

function applyTheme() {
  const resolved = theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.dataset.theme = resolved;
  // The bar at the top of a phone matches the page rather than staying dark over a light one.
  document.querySelector('meta[name=theme-color]')?.setAttribute(
    'content', resolved === 'light' ? '#ffffff' : '#0b0e14',
  );
  // The mark is a fixed-colour file, so it needs a twin rather than a filter: a dark tile
  // with nine grey eyes on a white page is a black box, which is what it was.
  for (const img of document.querySelectorAll('img.mark, link[rel=icon]')) {
    const at = img.tagName === 'IMG' ? 'src' : 'href';
    img.setAttribute(at, resolved === 'light' ? '/mark-light.svg' : '/mark.svg');
  }
  const b = document.getElementById('theme');
  if (b) {
    b.dataset.mode = resolved;
    b.title = t('Theme: {mode}', { mode: t(theme) });
    b.setAttribute('aria-label', t('Theme: {mode}', { mode: t(theme) }));
  }
}

matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (theme === 'auto') applyTheme();
});

// The stored strength, before the first tile paints.
window.addEventListener('DOMContentLoaded', () => applyWash(), { once: true });

/** Four to choose from, and whatever the browser asked for as the default.
 *
 *  Its own sheet rather than a row in a machine's: the language is not a fact about a
 *  machine, and this is the only board-wide setting that needs somewhere to live.
 */
function pickLanguage() {
  const sheet = el('dialog', { className: 'sheet' });
  const close = () => sheet.close();
  const list = el('div', { className: 'langlist' });
  for (const { code, name } of LANGUAGES) {
    list.append(el('button', {
      className: `langrow${code === activeLang ? ' on' : ''}`, type: 'button',
      textContent: name,
      onclick: async () => {
        localStorage.setItem(LANG, code);
        await loadLanguage(code);
        close();
        retitle();
        draw();
      },
    }));
  }
  sheet.append(
    el('h2', { textContent: t('Language') }),
    list,
    el('div', { className: 'sheetfoot' }, [
      el('button', { className: 'ghost', type: 'button', textContent: t('Close'), onclick: close }),
    ]),
  );
  document.body.append(sheet);
  sheet.addEventListener('close', () => sheet.remove());
  sheet.showModal();
}

/** The words baked into the page, said again in the language now in force. */
function retitle() {
  const j = document.getElementById('journal');
  if (j) j.textContent = t('journal');
  for (const [id, text] of [['lang', 'Language'], ['full', 'Full screen']]) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.title = t(text);
    b.setAttribute('aria-label', t(text));
  }
  applyTheme();     // its own label carries the mode, so it has to be redone here
}

document.getElementById('lang')?.addEventListener('click', pickLanguage);
document.getElementById('journal')?.addEventListener('click', journalSheet);

document.getElementById('theme')?.addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  localStorage.setItem(THEME, theme);
  applyTheme();
});

applyTheme();

/* Installable, and quick to open — but only where the browser allows it.
 *
 *  A service worker needs a secure context. `isSecureContext` rather than a protocol test,
 *  because `http://localhost` counts as one and so does an origin you have told Chrome to
 *  trust in `chrome://flags/#unsafely-treat-insecure-origin-as-secure` — which is the honest
 *  answer to "can I install this from my phone on a LAN": yes, if you say so explicitly, or
 *  put a real certificate in front with `tailscale serve`.
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* The catalogue before the first paint. `draw()` is what puts words on the screen and it is
 * kicked off below; this has to have landed by then or the first frame is English and the
 * second one is not, which reads as a flicker nobody can explain. */
const translated = knownLanguages()
  .then(() => loadLanguage(preferredLanguage()))
  .then(retitle);

/** Somewhere to put the token when you did not arrive by link.
 *
 *  The message used to say the address needed one and then offer nowhere to type it, which
 *  is a door with a sign on it and no handle. It happens more than it sounds: a browser
 *  keeps its keys per origin, so reaching the same board by name after having reached it
 *  by address is arriving somewhere new.
 */
function askForToken(why) {
  const field = el('input', {
    type: 'password', className: 'tokenbox', placeholder: t('token'),
    autocomplete: 'off', spellcheck: false,
  });
  const go = el('button', { className: 'primary', textContent: t('Open') });
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

/* Three answers, most personal first.
 *
 *  A colour you picked here beats one written in the config, because the config is what
 *  everyone sees and this is your browser. The config beats the hash, because someone
 *  bothered to write it down. And the hash is there so that a board nobody has configured
 *  is still readable — which is the state every board starts in.
 */
/* How strongly a machine's colour washes its tile.
 *
 *  The default is faint on purpose — the board's job is to say which machine wants you, and
 *  a tile shouting its own identity competes with that. But faint enough to be unsure it is
 *  there is not a default, it is a bug you cannot report, so it is a setting.
 *
 *  A multiplier rather than a percentage: the two themes need different amounts to look the
 *  same, and a number chosen in one of them would be wrong in the other.
 */
const WASH = 'panoptes.wash';
const WASHES = [0, 1, 2, 3, 4.5];
let washStep = (() => {
  const n = Number(localStorage.getItem(WASH));
  return Number.isInteger(n) && n >= 0 && n < WASHES.length ? n : 2;
})();

function applyWash() {
  document.documentElement.style.setProperty('--wash-mul', String(WASHES[washStep]));
}

const PICKS = 'panoptes.colours';
let picks = (() => { try { return JSON.parse(localStorage.getItem(PICKS)) || {}; } catch { return {}; } })();
const savePicks = () => localStorage.setItem(PICKS, JSON.stringify(picks));

/* A line of your own on a tile.
 *
 *  Everything else a tile says, a machine said. This is the part only you know: what the box
 *  is for, who else uses it, why it is at 96% and whether that matters. Kept the same way
 *  colours are — yours in this browser, a default in the config for everyone — because it is
 *  the same kind of fact about the same thing.
 */
const NOTES = 'panoptes.notes';
const MAX_NOTE = 140;
let notes = (() => { try { return JSON.parse(localStorage.getItem(NOTES)) || {}; } catch { return {}; } })();
const saveNotes = () => localStorage.setItem(NOTES, JSON.stringify(notes));
const noteFor = (machine) => (notes[machine.name] ?? machine.note ?? '').trim();

function fromPalette(said) {
  if (said == null || said === '') return null;
  if (/^#[0-9a-fA-F]{6}$/.test(said)) return said;
  const n = Number(said);
  return Number.isInteger(n) ? MACHINE_COLOURS[((n % MACHINE_COLOURS.length) + MACHINE_COLOURS.length) % MACHINE_COLOURS.length] : null;
}

function colourFor(machine) {
  const name = typeof machine === 'string' ? machine : machine.name;
  const mine = fromPalette(picks[name]);
  if (mine) return mine;
  const said = typeof machine === 'object' ? fromPalette(machine.colour) : null;
  if (said) return said;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MACHINE_COLOURS[h % MACHINE_COLOURS.length];
}

/** One request to the board, which passes it on. Throws with what the machine said. */
async function ask(path) {
  const r = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const said = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(said.detail || `${r.status}`);
  return said;
}

/** Turning an Argus off.
 *
 *  Not beside the start/stop buttons, because it is not one of them: those manage work on a
 *  machine, this one takes away the way in. Nothing on this board can undo it — afterwards
 *  there is nothing listening — so it asks twice and says plainly what it costs.
 *
 *  Only shown when the machine offers it: `may_stop_argus` on that machine's watcher entry.
 */

/** Forgetting asks too, and says the thing people get wrong about it: it does not stop
 *  anything. The machine carries on; the board simply stops listing it, until it calls in
 *  again — which it will, if it is still running and still configured to. */
function confirmForget(name) {
  return new Promise((resolve) => {
    const sheet = el('dialog', { className: 'sheet' });
    const finish = (answer) => { resolve(answer); sheet.close(); };
    sheet.append(
      el('h2', { textContent: t('Take {name} off the board?', { name }) }),
      el('p', { className: 'hint', textContent: t('This does not stop it. If {name} is still running and still announcing itself, it will reappear on its next call-in — this is for machines that are gone.', { name }) }),
      el('div', { className: 'sheetfoot' }, [
        el('button', { className: 'ghost', type: 'button', textContent: t('Cancel'), onclick: () => finish(false) }),
        el('button', { className: 'ghost danger', type: 'button', textContent: t('Forget'), onclick: () => finish(true) }),
      ]),
    );
    document.body.append(sheet);
    sheet.addEventListener('close', () => sheet.remove());
    sheet.addEventListener('cancel', () => resolve(false));
    sheet.showModal();
    sheet.querySelector('.sheetfoot .ghost')?.focus();
  });
}

/** The second ask. A modal, because this is the one action on the board that is one-way. */
function confirmStop(name) {
  return new Promise((resolve) => {
    const sheet = el('dialog', { className: 'sheet' });
    const finish = (answer) => { resolve(answer); sheet.close(); };
    sheet.append(
      el('h2', { textContent: t('Stop Argus on {name}?', { name }) }),
      el('p', { className: 'hint', textContent: t('Every tmux session keeps running — Argus only watches them. But this board cannot start it again: that takes a shell on {name}, or whatever supervises it there.', { name }) }),
      el('div', { className: 'sheetfoot' }, [
        el('button', { className: 'ghost', type: 'button', textContent: t('Cancel'), onclick: () => finish(false) }),
        el('button', { className: 'ghost danger', type: 'button', textContent: t('Stop it'), onclick: () => finish(true) }),
      ]),
    );
    document.body.append(sheet);
    sheet.addEventListener('close', () => sheet.remove());
    sheet.addEventListener('cancel', () => resolve(false));
    sheet.showModal();
    // Cancel, not Stop. A dialog that opens with the destructive button focused turns a
    // stray Enter — or the second half of a double-click on the power icon — into a
    // stopped machine.
    sheet.querySelector('.sheetfoot .ghost')?.focus();
  });
}

/** What was done on this board, and what was refused.
 *
 *  In a sheet from the footer rather than a button in the header: it is board-wide and rarely
 *  opened, which is what the footer is for, and the header already carries four things that a
 *  phone has to fit on one line.
 */
async function journalSheet() {
  const sheet = el('dialog', { className: 'sheet wide' });
  const close = () => sheet.close();
  const rows = el('div', { className: 'jrows' });
  const count = el('span', { className: 'dim' });

  let said;
  try {
    const r = await fetch('/api/journal?limit=300', { headers: { Authorization: `Bearer ${token}` } });
    said = await r.json();
  } catch {
    said = { entries: [], refused: 0 };
  }
  const entries = said.entries || [];
  const when = (at) => new Date(at * 1000).toLocaleString();

  let only = 'all';
  let needle = '';
  const shows = (one) => {
    if (only === 'refused' && !one.refused) return false;
    if (only === 'changes' && one.refused) return false;
    if (!needle) return true;
    return [one.who, one.did, one.what, one.from, one.via, one.status]
      .join(' ').toLowerCase().includes(needle);
  };

  const paint = () => {
    const showing = entries.filter(shows);
    rows.replaceChildren(...showing.map((one) => el('div', { className: `jrow${one.refused ? ' refused' : ''}` }, [
      el('span', { className: 'grow' }, [
        el('span', { className: 'jdid', textContent: one.did || '?' }),
        el('span', { className: 'meta', textContent: [
          one.who,
          one.what,
          one.times > 1 ? t('{n} times', { n: one.times }) : '',
        ].filter(Boolean).join(' · ') }),
      ]),
      el('span', { className: 'jfrom', textContent: one.via ? `${one.from} → ${one.via}` : (one.from || '') }),
      el('span', { className: `state${one.refused ? ' bad' : ''}`, textContent: String(one.status) }),
      el('span', { className: 'jwhen', textContent: when(one.at) }),
    ])));
    if (!showing.length) rows.append(el('p', { className: 'hint', textContent: t('Nothing matches that.') }));
    count.textContent = showing.length === entries.length
      ? t('{n} entries', { n: entries.length })
      : t('{n} of {total}', { n: showing.length, total: entries.length });
  };

  const pick = (id, label) => el('button', {
    className: `chip${only === id ? ' on' : ''}`, type: 'button', textContent: label,
    onclick: (e) => {
      only = id;
      for (const other of bar.querySelectorAll('.chip')) other.classList.toggle('on', other === e.currentTarget);
      paint();
    },
  });
  const bar = el('div', { className: 'jbar' }, [
    pick('all', t('Everything')),
    pick('refused', t('Refused')),
    pick('changes', t('Changes')),
    el('input', {
      type: 'search', className: 'jfind', placeholder: t('an address, a key, an action…'),
      spellcheck: false,
      oninput: (e) => { needle = e.target.value.trim().toLowerCase(); paint(); },
    }),
    count,
  ]);

  put(sheet,
    el('h2', { textContent: t('Journal') }),
    el('p', { className: 'hint', textContent: entries.length
      ? t('Everything that changed something, and everything that was refused. A machine calling in is not recorded; a refused one is.')
      : t('Nothing recorded yet.') }),
    said.refused
      ? el('p', { className: 'notice', textContent: t('{n} refused attempts. A run of them from an address you do not recognise is the thing to look at.', { n: said.refused }) })
      : null,
    bar,
    rows,
    el('div', { className: 'sheetfoot' }, [
      el('button', { className: 'ghost', type: 'button', textContent: t('Close'), onclick: close }),
    ]),
  );
  paint();
  document.body.append(sheet);
  sheet.addEventListener('close', () => sheet.remove());
  sheet.showModal();
}

/** Write the note, on the tile, without leaving it.
 *
 *  Saved as it is typed: a note is one line about a machine, not a form, so a Save button
 *  would be a second thing to remember for no gain. Escape and clicking away both just stop
 *  editing — neither can lose what was written, because it was never held anywhere else.
 */
function editNote(machine, card, done) {
  if (card.querySelector('.notebox')) return card.querySelector('.notebox').focus();
  const name = machine.name;
  const box = el('textarea', {
    className: 'notebox', rows: 2, maxLength: MAX_NOTE, spellcheck: false,
    placeholder: machine.note ? t('{note} (from the config)', { note: machine.note })
      : t('what this machine is for'),
    value: notes[name] ?? '',
  });
  box.addEventListener('input', () => {
    const written = box.value.slice(0, MAX_NOTE);
    if (written.trim()) notes = { ...notes, [name]: written };
    else { const { [name]: _drop, ...rest } = notes; notes = rest; }   // empty means the config's, or none
    saveNotes();
  });
  // The tile is a link and the card is listening for clicks; typing in here is neither.
  for (const noisy of ['click', 'keydown', 'pointerdown']) {
    box.addEventListener(noisy, (e) => e.stopPropagation());
  }
  const finish = () => { box.remove(); done(); };
  box.addEventListener('blur', finish);
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); box.blur(); } });

  // Where the note itself sits, so it is edited in the place it will appear.
  const existing = card.querySelector('.note');
  if (existing) existing.replaceWith(box);
  else card.querySelector('.cardhead').after(box);
  box.focus();
  box.select();
}

/** What a tile can be asked, gathered in one place.
 *
 *  The colour picker lived on the machine's dot, which is .55rem across and, however many
 *  title attributes it wore, was a control nobody found. Everything a tile offers beyond
 *  "open it" goes behind one ⋯ instead: findable, out of the way, and somewhere for the next
 *  thing to live rather than another button competing with the tile itself.
 */
function machineSheet(machine, done) {
  const name = machine.name;
  const sheet = el('dialog', { className: 'sheet' });
  const close = () => sheet.close();

  const swatches = el('div', { className: 'swatches' });
  MACHINE_COLOURS.forEach((c, i) => {
    const b = el('button', {
      className: `swatch${String(picks[name]) === String(i) ? ' on' : ''}`,
      type: 'button', title: t('colour {n}', { n: i + 1 }), 'aria-label': t('colour {n}', { n: i + 1 }),
    });
    b.style.background = c;
    b.onclick = () => { picks = { ...picks, [name]: i }; savePicks(); close(); done(); };
    swatches.append(b);
  });

  /* One strength for every tile, not for this one. Per-machine it would read as an accident
   * — three tiles at three different depths of the same idea — and the question anyone
   * actually has is "make them all clearer". Said so on the label, since a global control
   * inside a sheet named after one machine is otherwise a trap. */
  const strengths = el('div', { className: 'washes' });
  const paintStrengths = () => {
    strengths.replaceChildren(...WASHES.map((mul, i) => {
      const b = el('button', {
        className: `wash${i === washStep ? ' on' : ''}`, type: 'button',
        title: mul === 0 ? t('no tint') : t('tint × {n}', { n: mul }),
        'aria-label': mul === 0 ? t('no tint') : t('tint times {n}', { n: mul }),
      });
      // Each button shows what it does, in the colour it would do it to.
      b.style.background = mul === 0 ? 'transparent'
        : `color-mix(in srgb, ${colourFor(machine)} calc(var(--wash-base) * ${mul}), var(--panel))`;
      b.onclick = () => {
        washStep = i;
        localStorage.setItem(WASH, String(i));
        applyWash();
        paintStrengths();
      };
      return b;
    }));
  };
  paintStrengths();

  /* What this machine will let you start and stop.
   *
   *  The list comes from the machine, in its overview — the board neither knows nor invents
   *  it, and it is empty unless somebody wrote `runnable` in that machine's own config. So an
   *  ordinary board shows nothing here, which is correct: the ability to press these has to
   *  be granted on the machine, not assumed by the page.
   */
  const offers = machine.runnable || [];
  const doing = el('div', { className: 'offers' });
  const paintOffers = () => {
    doing.replaceChildren(...offers.map((one) => {
      const state = el('span', { className: `sw${one.running ? ' on' : ''}`,
        textContent: one.running ? t('running') : t('stopped') });
      const press = el('button', {
        className: 'ghost', type: 'button',
        textContent: one.running ? t('Stop') : t('Start'),
        onclick: async () => {
          press.disabled = true;
          press.textContent = '…';
          try {
            const said = await ask(`/api/do/${encodeURIComponent(name)}`
              + `/${encodeURIComponent(one.name)}/${one.running ? 'stop' : 'start'}`);
            // A machine the board cannot reach is told in the reply to its own next
            // announcement, so "queued" is the honest answer rather than a green tick.
            toast(said.queued ? t('{name} will be told next time it calls in', { name })
              : t('{what}: {did}', { what: one.name, did: t(said.did || 'done') }));
          } catch (e) {
            toast(e.message, true);
          }
          close();
          done();
        },
      });
      return el('div', { className: 'offer' }, [
        el('span', { className: 'grow', textContent: one.name }), state, press,
      ]);
    }));
  };
  paintOffers();

  /* Stopping this Argus is not in here.
   *
   *  It lives on the tile, as the power icon, where the machine allows it. It was also
   *  explained here — a greyed row saying which config line grants it — and that was one row
   *  too many: a sheet about colours and a note listing a permission you have not granted are
   *  two different conversations, and the second one never ends. The README says where the
   *  line goes.
   */
  /* Taking a machine off the board for good.
   *
   *  Only for one that announced itself: a configured machine would come straight back on the
   *  next sweep and the button would look broken, so it is not offered — the config is where
   *  it came from and the config is where it goes.
   *
   *  It exists because the board remembers announced machines now. That is what makes a
   *  stopped one stay visible and red instead of vanishing, and the price is that a
   *  decommissioned one would sit there for ever. The board cannot tell "off for ten minutes"
   *  from "gone", so it does not guess.
   */
  const forget = machine.announced ? el('div', { className: 'offer' }, [
    el('span', { className: 'grow' }, [
      el('span', { className: 'dim', textContent: t('Take it off the board') }),
      el('span', { className: 'meta', textContent: t('it announced itself; forgetting is not stopping it') }),
    ]),
    el('button', {
      className: 'ghost danger', type: 'button', textContent: t('Forget'),
      onclick: async () => {
        if (!await confirmForget(name)) return;
        try {
          const r = await fetch(`/api/machines/${encodeURIComponent(name)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
          });
          const said = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(said.detail || `${r.status}`);
          toast(t('{name} is off the board', { name }));
        } catch (e) { toast(e.message, true); }
        close();
        done();
      },
    }),
  ]) : null;

  put(sheet,
    el('h2', { textContent: name }),
    offers.length ? el('h3', { textContent: t('Start and stop') }) : null,
    offers.length ? doing : null,
    el('h3', { textContent: t('Colour') }),
    swatches,
    el('h3', { textContent: t('Tint strength — every tile') }),
    strengths,
    forget ? el('h3', { textContent: t('This machine') }) : null,
    forget,
    el('div', { className: 'sheetfoot' }, [
      el('button', {
        className: 'ghost', type: 'button', textContent: t('Automatic'),
        title: t('back to the colour this name gives'),
        onclick: () => { const { [name]: _drop, ...rest } = picks; picks = rest; savePicks(); close(); done(); },
      }),
      el('button', { className: 'ghost', type: 'button', textContent: t('Close'), onclick: close }),
    ]),
  );
  document.body.append(sheet);
  sheet.addEventListener('close', () => { sheet.remove(); done(); });
  // The tile underneath is a link; nothing that happens in here is a click on it.
  sheet.addEventListener('click', (e) => e.stopPropagation());
  sheet.showModal();
  return sheet;
}

const svgEl = (tag, props = {}, kids = []) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(props)) node.setAttribute(k, v);
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
};

/** Drawn rather than typed. `⧉` is missing from the fonts a browser falls back to, so the
 *  copy button was there, focusable, clickable, and invisible. */
const GLYPHS = {
  copy: 'M9 8.5h10.5V20H9zM5 15.5V4h10.5',
  more: 'M12 6.2v.01M12 12v.01M12 17.8v.01',
  pencil: 'M4.5 19.5h4L18 10l-4-4-9.5 9.5zM13 7l4 4',
  // The universal power glyph, which needs no label in any language.
  power: 'M12 3.5v7.5M7.4 6.4a7 7 0 1 0 9.2 0',
};

const icon = (name) => svgEl('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true' },
  svgEl('path', {
    d: GLYPHS[name], fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

const el = (tag, props = {}, kids = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
};

/** `append` with the same manners as `el`.
 *
 *  `ParentNode.append` stringifies whatever it is given, so a `cond ? node : null` in the
 *  argument list puts the word "null" on the screen. It did: a tile with nothing to start
 *  and no permission to be stopped had three of those conditions, and its sheet said
 *  `nullnullnull` under the machine's name.
 */
const put = (parent, ...kids) => {
  for (const kid of kids) if (kid) parent.append(kid);
  return parent;
};

const ago = (seconds) => {
  if (seconds == null) return t('never');
  if (seconds < 90) return t('{n}s ago', { n: Math.round(seconds) });
  if (seconds < 5400) return t('{n}m ago', { n: Math.round(seconds / 60) });
  return t('{n}h ago', { n: Math.round(seconds / 3600) });
};

/** Copy, including over plain http where `navigator.clipboard` does not exist — which is
 *  exactly how a board on a LAN is reached. Argus carries the same helper for the same
 *  reason; a board that cannot hand you an address is a board you retype by hand.
 */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* the old way */ }
  }
  const ta = el('textarea', { value: text, readOnly: true });
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '-9999px' });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Said once, bottom centre, gone in a moment. There is nothing else on this page that
 *  needs to say anything, so it does not need to be more than this. */
function toast(message, bad = false) {
  const note = el('div', { className: `toast${bad ? ' bad' : ''}`, textContent: message });
  document.body.append(note);
  setTimeout(() => note.remove(), 2200);
}

/** How long something has been up. Coarse at the top and fine at the bottom, because the
 *  question changes with the answer: a machine up for months is "66d", an Argus started
 *  four minutes ago is "4m" — and rounding that to hours said "0h", which reads as a
 *  number that failed to arrive rather than as a fresh start. */
const upFor = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  // The unit letters are translated too: `d`, `h`, `m` and `s` are English abbreviations,
  // and a catalogue that could not change them would look half-done in every language.
  if (d) return t('{d}d {h}h', { d, h });
  if (h) return t('{h}h {m}m', { h, m: Math.floor((seconds % 3600) / 60) });
  const m = Math.floor(seconds / 60);
  return m ? t('{m}m', { m }) : t('{s}s', { s: Math.max(0, Math.round(seconds)) });
};

/** Why a machine is not answering, in the reader's language.
 *
 *  The server sends both a sentence and a code. The sentence is for an API reader and for a
 *  log; the code is what can be translated, because half of these have a number spliced into
 *  the middle and an English sentence cannot be a key when it is different every time.
 */
const REASONS = {
  timeout: 'no answer within {detail}s',
  refused: 'nothing listening there',
  unreachable: 'unreachable ({detail})',
  'bad-token': 'the token was refused',
  'wrong-door': 'that token may not ask this',
  status: 'answered {detail}',
  'not-overview': 'answered something that was not an overview',
  'not-asked': 'not asked yet',
  silent: 'has not called in',
};

function whyNot(machine) {
  const pattern = REASONS[machine.reason];
  // An older board, or a reason nobody has coded yet: its English is better than nothing.
  if (!pattern) return machine.why || t('unreachable');
  return t(pattern, { detail: machine.detail || '' });
}

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
    title: why === 'asking' ? t('waiting for you')
      : why === 'done' ? t('finished')
        : session.attached ? t('attached') : t('running'),
  });
  chip.append(el('span', { className: 'dot' }));
  chip.append(el('span', { textContent: session.name }));
  if (session.windows > 1) chip.append(el('span', { className: 'dim', textContent: `·${session.windows}` }));
  return chip;
}

/** Alive, doubtful, or gone — and how sure the board is.
 *
 *  `ok` used to be a boolean shown the same way for both kinds of machine, and for one that
 *  announces itself that is a lie with a timer on it: it means "called in within the grace
 *  period", so a box that had been dead for forty seconds still read as perfectly fine. A
 *  polled machine is different — the board spoke to it three seconds ago and knows.
 *
 *  Three states, so the middle one exists at all:
 *    green   heard from well within the time it promised
 *    amber   overdue, but not yet long enough to call it gone
 *    red     silent past the grace, or refusing to answer
 */
function health(machine) {
  if (!machine.ok) return { state: 'dead', why: whyNot(machine) };
  const quiet = machine.quiet ?? 0;
  const grace = machine.grace || 0;
  // Polled machines carry no grace: the board asked, and got an answer.
  const overdue = grace ? quiet > grace / 3 : quiet > 30;
  return overdue
    ? { state: 'doubt', why: t('last heard {when}', { when: ago(quiet) }) }
    : { state: 'alive', why: t('answering') };
}

function card(machine) {
  const state = health(machine);
  const life = el('span', {
    className: `mdot led ${state.state}`,
    title: state.why,
    'aria-label': state.why,
  });

  const head = el('div', { className: 'cardhead' }, [
    life,
    el('a', {
      className: 'name', href: machine.url, target: '_blank', rel: 'noopener noreferrer',
      textContent: machine.name,
    }),
  ]);

  /* The readings wrap; the buttons do not.
   *
   *  With the whole header wrapping, a long name and two readings pushed the buttons onto a
   *  line of their own — and which tile that happened to depended on the name, so no two
   *  agreed. They live in a box that cannot break instead, and only the readings inside their
   *  own box are allowed to.
   *
   *  There used to be a `.grow` spacer between the name and these, and it was the whole
   *  problem: a spacer with `flex: 1` takes every pixel of slack, so the readings were handed
   *  less than they needed and wrapped while 17px sat unused beside them. They are pushed
   *  right with `margin-left: auto` now, which asks for no space of its own.
   */
  const readouts = el('span', { className: 'readouts' });
  head.append(readouts);

  // A colour is a glance; the words are for when the glance made you look twice. Only shown
  // when there is something to say, so an ordinary tile does not carry a timestamp for ever.
  if (state.state === 'doubt') {
    readouts.append(el('span', { className: 'state warn', textContent: state.why }));
  }

  if (!machine.ok) {
    readouts.append(el('span', { className: 'state bad', textContent: whyNot(machine) }));
  } else {
    const load = machine.load_pct ?? 0;
    readouts.append(el('span', {
      className: `state${load > 90 ? ' warn' : ''}`,
      textContent: t('load {n}', { n: machine.load?.[0] ?? '?' }),
      title: t('{n} cores', { n: machine.cores }) + ` · ${machine.load?.join(' ') || ''}`,
    }));
    if (machine.disk) {
      // A root like `/home/someone/work 18%` truncated to `/home/someone/w...`, losing the
      // number — which is the only part anyone reads. The tail of a path is the part that
      // identifies it, so a long one keeps its tail and says the whole thing on hover.
      const path = machine.disk.path;
      const tail = path.split('/').filter(Boolean).pop() || path;
      const short = path.length > 12 ? `…/${tail.length > 11 ? `${tail.slice(0, 10)}…` : tail}` : path;
      readouts.append(el('span', {
        className: `state${machine.disk.level === 'critical' ? ' bad' : machine.disk.level === 'high' ? ' warn' : ''}`,
        textContent: `${short} ${Math.round(machine.disk.pct)}%`,
        title: t('{path} — {pct}% full', { path, pct: Math.round(machine.disk.pct) }),
      }));
    }
  }

  /* Stopping this Argus, where the machine allows it.
   *
   *  It was three levels down — ⋯, then a sheet, then a confirmation — which is a lot of
   *  looking for the one action you reach for when a machine is misbehaving and you are not
   *  in front of it. On the tile it is one tap away and still two taps to fire, because the
   *  confirmation stays: this is the only thing on the board that cannot be undone from here.
   *
   *  An icon rather than a word: it is the power symbol, it needs no translating, and a
   *  button reading "Stop" beside a tile that is itself a link is a mis-tap waiting to
   *  happen on a phone. Absent entirely unless that machine granted it, so an ordinary board
   *  carries no red buttons at all.
   */
  const acts = el('span', { className: 'acts' });
  head.append(acts);

  /* The note, written on the tile.
   *
   *  It lived in the sheet that sets the colour, which put two unrelated jobs behind one
   *  button: changing how a machine looks and writing down what it is for are not the same
   *  errand, and the second is the one you do in a hurry. A pencil beside the name opens a box
   *  in place, on the tile the note belongs to.
   */
  acts.append(el('button', {
    className: 'pencil', type: 'button',
    title: t('a note about {name}', { name: machine.name }),
    'aria-label': t('a note about {name}', { name: machine.name }),
    onclick: (e) => { e.stopPropagation(); editNote(machine, card, draw); },
  }, icon('pencil')));

  if (machine.can_stop_argus) {
    acts.append(el('button', {
      className: 'kill', type: 'button',
      title: t('Stop Argus on {name}?', { name: machine.name }),
      'aria-label': t('Stop Argus on {name}?', { name: machine.name }),
      onclick: async (e) => {
        e.stopPropagation();
        if (!await confirmStop(machine.name)) return;
        try {
          const said = await ask(`/api/do/${encodeURIComponent(machine.name)}/argus/stop`);
          toast(said.queued
            ? t('{name} will be told next time it calls in', { name: machine.name })
            : t('{name} is stopping — its sessions carry on', { name: machine.name }));
        } catch (err) {
          toast(err.message, true);
        }
        draw();
      },
    }, icon('power')));
  }

  acts.append(el('button', {
    className: 'more', type: 'button',
    title: t('more about {name}', { name: machine.name }),
    'aria-label': t('more about {name}', { name: machine.name }),
    onclick: (e) => { e.stopPropagation(); machineSheet(machine, draw); },
  }, icon('more')));

  const note = noteFor(machine);

  const sessions = machine.sessions || [];
  const body = el('div', { className: 'chips' });
  if (sessions.length) {
    for (const s of sessions) body.append(sessionChip(s, machine.url));
  } else if (machine.ok) {
    body.append(el('span', { className: 'dim', textContent: t('no sessions') }));
  }
  // A machine that is down said "nothing listening there" in its header already; the
  // footer says when it last answered. Saying it a third time in the middle is noise.

  /* Two uptimes, because they answer different questions and only one of them is about
   * Argus. The machine's is what you want most of the time; the process's is what tells
   * you this one restarted an hour ago, and it is the only one that differs when several
   * Argus instances are on the same box — which is exactly when a board looks wrong.
   * Shown only when it is meaningfully shorter: on a machine that has been up as long as
   * the Argus on it, saying it twice is noise.
   */
  const said = [];
  if (machine.ok && machine.uptime) {
    said.push(t('up {age}', { age: upFor(machine.uptime) }));
    if (machine.serving != null && machine.serving < machine.uptime * 0.95) {
      said.push(t('argus {age}', { age: upFor(machine.serving) }));
    }
    said.push(t('{pct}% memory', { pct: Math.round(machine.memory_pct) }));
  } else {
    said.push(t('last answered {when}', { when: ago(machine.ago) }));
  }

  const foot = el('div', { className: 'cardfoot dim' }, [
    el('div', { className: 'readings', textContent: said.join(' · ') }),
  ]);

  /* The address, and a button that copies it.
   *
   *  Clicking the tile opens the machine here, in this browser — which is no use when the
   *  address is what you want: to paste into a terminal, into a note, into a message to
   *  somebody else, or into the other browser you are actually working in. The board knows
   *  it and nowhere else does, so reading an address off a screen and retyping it is the
   *  alternative. No token is in it: the board has never held that machine's real one.
   */
  if (machine.url) {
    const shown = machine.url.replace(/^https?:\/\//, '');
    // Its own row, address and button together. Sharing a line with the readings meant the
    // button wrapped away from the address it belongs to as soon as a name got long — and
    // which line it landed on depended on the machine, so no two tiles agreed.
    const line = el('div', { className: 'addrline' });
    foot.append(line);
    line.append(el('span', { className: 'addr', textContent: shown, title: machine.url }));
    line.append(el('button', {
      className: 'copy', type: 'button', title: t('copy {url}', { url: machine.url }), 'aria-label': t('copy {url}', { url: machine.url }),
      onclick: async (e) => {
        e.stopPropagation();     // the tile opens the machine; this button does not
        const ok = await copyText(machine.url);
        toast(ok ? machine.url : t('could not reach the clipboard'), !ok);
      },
    }, icon('copy')));
  }

  const wants = sessions.some((s) => s.bell === 'asking');
  const card = el('article', {
    className: `card${wants ? ' wants' : ''}${machine.ok ? '' : ' cold'}${machine.url ? ' open' : ''}`,
    // Safe as written: `el` drops falsy children. `append` does not — see `put`.
  }, [head, note ? el('p', { className: 'note', textContent: note }) : null, body, foot]);
  // Down the left edge, which is also where "this one wants you" is said — so a machine
  // asking for you overrides its own colour rather than competing with it.
  card.style.setProperty('--mc', colourFor(machine));

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
    card.addEventListener('click', (e) => { if (!e.target.closest('a, button')) go(); });
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
  // Not while somebody is writing a note. The board rebuilds every tile from scratch, so a
  // sweep landing mid-sentence would take the box away with the cursor still in it — every
  // four seconds, which is to say always.
  if (document.querySelector('.notebox')) return;

  let answer;
  try {
    const r = await fetch('/api/board', { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) {
      askForToken(token ? t('That token was refused.') : t('This board needs its token.'));
      return;
    }
    answer = await r.json();
  } catch {
    swept.textContent = t('cannot reach the board itself');
    return;
  }

  const machines = answer.machines || [];
  board.replaceChildren(...machines.map(card));
  if (!machines.length) {
    board.replaceChildren(el('p', { className: 'empty', textContent: t('No machines yet. Add them to the config and restart.') }));
  }
  const waiting = machines.reduce((n, m) => n + (m.sessions || []).filter((s) => s.bell === 'asking').length, 0);
  /* Tiles are Argus instances, not machines, and on this board three of them are on one
   * box. Saying "4 machines" was simply wrong. The board already keeps what each one calls
   * itself apart from what you called it, so the two can be counted separately — and when
   * they agree, which is the usual case, only one number is worth saying.
   */
  const hosts = new Set(machines.map((m) => m.hostname || m.name)).size;
  count.textContent = (hosts === machines.length
    ? t(machines.length === 1 ? '{n} machine' : '{n} machines', { n: machines.length })
    : t(hosts === 1 ? '{n} argus on {h} machine' : '{n} argus on {h} machines',
      { n: machines.length, h: hosts }))
    + (waiting ? ' · ' + t('{n} waiting for you', { n: waiting }) : '');
  swept.textContent = answer.swept
    ? t('swept {when}', { when: ago((Date.now() / 1000) - answer.swept) })
    : t('sweeping…');
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

// After the catalogue, not before it: a first frame in English followed by a second one in
// Italian is a flicker nobody can explain, and it happens on every load.
translated.then(draw);
// Slightly slower than the server's own sweep: asking faster than it learns is noise.
setInterval(() => { if (!document.hidden) draw(); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
