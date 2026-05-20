export function renderJsonViewer(value, options = {}) {
  const title = options.title ?? 'db JSON';
  const json = normalizeJsonText(value);
  const formatted = formatJsonText(json);
  const compact = compactJsonText(json);

  return `<!doctype html>
<html lang="en" data-theme-mode="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-950 text-slate-50 antialiased">
  <header class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 bg-slate-900 px-5 py-4 text-slate-50 sm:flex-nowrap" data-theme-surface="header">
    <h1 class="m-0 min-w-0 truncate text-base font-bold leading-tight">${escapeHtml(title)}</h1>
    <div class="flex flex-wrap items-center justify-end gap-2">
      <div class="inline-flex overflow-hidden rounded-md border border-slate-700 bg-slate-800" aria-label="Theme" data-theme-surface="control">
        <button class="min-h-9 bg-teal-700 px-3 py-2 text-[13px] font-bold text-white hover:bg-teal-600" type="button" data-theme-choice="dark" aria-pressed="true">Dark</button>
        <button class="min-h-9 px-3 py-2 text-[13px] font-bold text-slate-50 hover:bg-slate-700" type="button" data-theme-choice="light" aria-pressed="false">Light</button>
        <button class="min-h-9 px-3 py-2 text-[13px] font-bold text-slate-50 hover:bg-slate-700" type="button" data-theme-choice="system" aria-pressed="false">System</button>
      </div>
      <div class="inline-flex overflow-hidden rounded-md border border-slate-700 bg-slate-800" aria-label="Formatting" data-theme-surface="control">
        <button class="min-h-9 bg-teal-700 px-3 py-2 text-[13px] font-bold text-white hover:bg-teal-600" type="button" data-format-choice="pretty" aria-pressed="true">Pretty</button>
        <button class="min-h-9 px-3 py-2 text-[13px] font-bold text-slate-50 hover:bg-slate-700" type="button" data-format-choice="raw" aria-pressed="false">Raw</button>
      </div>
      <button class="min-h-9 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] font-bold text-slate-50 hover:border-teal-400 hover:bg-slate-700" type="button" id="copy-json">Copy</button>
      <span class="min-w-16 text-right text-[13px] text-slate-400" id="copy-status"></span>
    </div>
  </header>
  <main class="p-5">
    <pre class="m-0 min-h-[calc(100vh-112px)] overflow-auto rounded-lg border border-slate-700 bg-slate-900 p-4 font-mono text-[13px] leading-[1.55] text-slate-50 [tab-size:2]" id="json-output">${escapeHtml(formatted)}</pre>
  </main>
  <script>
    const root = document.documentElement;
    const copyButton = document.getElementById('copy-json');
    const status = document.getElementById('copy-status');
    const output = document.getElementById('json-output');
    const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
    const formatButtons = [...document.querySelectorAll('[data-format-choice]')];
    const formattedJson = ${JSON.stringify(formatted)};
    const compactJson = ${JSON.stringify(compact)};
    const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
    let currentTheme = 'dark';
    const themedSurfaces = [
      {
        element: document.body,
        dark: ['bg-slate-950', 'text-slate-50'],
        light: ['bg-slate-50', 'text-slate-950'],
      },
      {
        element: document.querySelector('[data-theme-surface="header"]'),
        dark: ['border-slate-700', 'bg-slate-900', 'text-slate-50'],
        light: ['border-slate-200', 'bg-white', 'text-slate-950'],
      },
      ...[...document.querySelectorAll('[data-theme-surface="control"]')].map((element) => ({
        element,
        dark: ['border-slate-700', 'bg-slate-800'],
        light: ['border-slate-300', 'bg-slate-100'],
      })),
      {
        element: document.getElementById('copy-json'),
        dark: ['border-slate-700', 'bg-slate-800', 'text-slate-50', 'hover:border-teal-400', 'hover:bg-slate-700'],
        light: ['border-slate-300', 'bg-slate-100', 'text-slate-700', 'hover:border-teal-500', 'hover:bg-slate-200'],
      },
      {
        element: document.getElementById('copy-status'),
        dark: ['text-slate-400'],
        light: ['text-slate-500'],
      },
      {
        element: output,
        dark: ['border-slate-700', 'bg-slate-900', 'text-slate-50'],
        light: ['border-slate-200', 'bg-white', 'text-slate-950'],
      },
    ];
    const activeButtonClasses = ['bg-teal-700', 'text-white', 'hover:bg-teal-600'];
    const inactiveButtonClasses = ['text-slate-50', 'hover:bg-slate-700', 'text-slate-700', 'hover:bg-slate-200'];

    function applyTheme(mode) {
      root.dataset.themeMode = mode;
      currentTheme = mode === 'system'
        ? (systemTheme.matches ? 'light' : 'dark')
        : mode;
      for (const surface of themedSurfaces) {
        if (!surface.element) {
          continue;
        }
        surface.element.classList.remove(...surface.dark, ...surface.light);
        surface.element.classList.add(...surface[currentTheme]);
      }
      for (const button of themeButtons) {
        setPressed(button, button.dataset.themeChoice === mode);
      }
      for (const button of formatButtons) {
        setPressed(button, button.getAttribute('aria-pressed') === 'true');
      }
    }

    for (const button of themeButtons) {
      button.addEventListener('click', () => {
        applyTheme(button.dataset.themeChoice);
      });
    }

    systemTheme.addEventListener('change', () => {
      if (root.dataset.themeMode === 'system') {
        applyTheme('system');
      }
    });

    function setFormat(mode) {
      output.textContent = mode === 'raw' ? compactJson : formattedJson;
      for (const button of formatButtons) {
        setPressed(button, button.dataset.formatChoice === mode);
      }
    }

    function setPressed(button, pressed) {
      button.setAttribute('aria-pressed', String(pressed));
      button.classList.remove(...activeButtonClasses, ...inactiveButtonClasses);
      button.classList.add(...(pressed
        ? activeButtonClasses
        : currentTheme === 'dark'
          ? ['text-slate-50', 'hover:bg-slate-700']
          : ['text-slate-700', 'hover:bg-slate-200']));
    }

    for (const button of formatButtons) {
      button.addEventListener('click', () => {
        setFormat(button.dataset.formatChoice);
      });
    }

    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(output.textContent);
        status.textContent = 'Copied';
      } catch {
        status.textContent = 'Copy failed';
      }
      setTimeout(() => {
        status.textContent = '';
      }, 1200);
    });
  </script>
</body>
</html>`;
}

function normalizeJsonText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatJsonText(value) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
}

function compactJsonText(value) {
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
