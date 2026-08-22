let taxonomyData = null;
let samplesData = null;
let iconsData = null;

async function loadTaxonomyTree(taxData, samples, icons) {
  if (taxonomyData === null) taxonomyData = taxData;
  if (samplesData === null) samplesData = samples;
  if (iconsData === null) iconsData = icons;
  if (taxonomyData === null || samplesData === null || iconsData === null) return;

  const container = document.getElementById("tree-container");
  container.innerHTML = ""; // avoid duplicates if called again

  function sampleCountForTaxonKey(key) {
    return Object.keys(samplesData).filter((sampleId) => {
      const sample = samplesData[sampleId];
      const lt = sample.lowest_taxa;
      return Array.isArray(lt) ? lt.includes(key) : lt === key;
    }).length;
  }

  // Root of the drawer's links. documentHref keeps the whole tree inside the language
  // being read, so opening the drawer on a Greek page does not walk you into English.
  const treeRoot = documentHref("tree");

  function buildTree(node, taxonPath = "") {
    const ul = document.createElement("ul");

    for (const [key, value] of Object.entries(node.subtaxa || {})) {
      const hasChildren = !!(value && value.subtaxa && Object.keys(value.subtaxa).length);
      const count = sampleCountForTaxonKey(key);

      const li = document.createElement("li");
      li.classList.add("tree-item");
      if (hasChildren) li.classList.add("has-children");
      // default collapse logic
      // 1. if in the parent path of the current page, expand
      const currentPath = window.location.href;
      if (currentPath.startsWith(taxonPath + `/${key}/`)) {
        // part of the current path, expand
      } else if (taxonPath != treeRoot) {
        // else expand top-level nodes only
        li.classList.add("is-collapsed"); // default to collapsed
      }

      // toggle button (only for nodes with children)
      let toggleBtn = null;
      if (hasChildren) {
        toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "tree-toggle";
        toggleBtn.setAttribute("aria-label", "Expand/collapse");
        toggleBtn.setAttribute("aria-expanded", "true");
        li.appendChild(toggleBtn);
      } else {
        // spacer to align nodes that do not have a toggle
        const spacer = document.createElement("span");
        spacer.className = "tree-toggle-spacer";
        li.appendChild(spacer);
      }

      // link
      const a = document.createElement("a");
      a.dataset.icon = getBaseURL() + `/images/thumbnails/thumbs_dir/${capitalize(value.name.el)}_thumb.webp`;
      a.href = `${taxonPath}/${key}/${key}.html`;
      a.id = `tree-node-${key}`;
      a.className = "tree-node";
      a.dataset.sampleCount = count;
      if (value.extinct) a.dataset.extinct = '1';

      // circular phylopic icon node
      const iconSpan = document.createElement("span");
      iconSpan.className = "node-icon";
      const phylopicUrl = iconsData[key];
      if (phylopicUrl) iconSpan.style.backgroundImage = `url("${phylopicUrl}")`;
      else iconSpan.classList.add("no-icon");
      a.appendChild(iconSpan);

      // label (kept in its own span so the translator never clobbers the icon)
      const labelSpan = document.createElement("span");
      labelSpan.className = "node-label";
      labelSpan.textContent = (value.extinct ? "†" : "") + (value.name?.en || key);
      a.appendChild(labelSpan);

      // sample-count badge
      const countSpan = document.createElement("span");
      countSpan.className = "node-count";
      if (count) countSpan.textContent = `${count}🦴`;
      else countSpan.style.display = "none";
      a.appendChild(countSpan);

      li.appendChild(a);

      // children (wrapped for a grid-based slide-down animation)
      if (hasChildren) {
        const childUl = buildTree(value, `${taxonPath}/${key}`);
        childUl.classList.add("tree-children");
        const wrap = document.createElement("div");
        wrap.className = "tree-children-wrap";
        wrap.appendChild(childUl);
        li.appendChild(wrap);
      }

      ul.appendChild(li);
    }

    return ul;
  }

  container.appendChild(buildTree({ subtaxa: taxonomyData }, treeRoot));

  // The tree is built lazily (on first sidebar open), after applyLanguage() already ran
  // on page load, so translate the freshly-built labels to the active language now.
  // Otherwise they'd stay lowercase English until the user manually switches language.
  updateSidebarTree(getLanguage());

  // Event delegation for toggles
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".tree-toggle");
    if (!btn) return;

    const li = btn.closest("li");
    const childWrap = li.querySelector(":scope > .tree-children-wrap");
    if (!childWrap) return;

    const isCollapsed = li.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", String(!isCollapsed));
  });
}


document.addEventListener('mouseover', function (e) {
  const node = e.target.closest('.tree-node');
  if (!node) return;

  const iconUrl = node.dataset.icon;
  if (!iconUrl) return;

  // avoid stacking previews when moving across the node's child spans
  document.querySelectorAll('.hover-icon-preview').forEach(el => el.remove());

  const img = document.createElement('img');
  const imgsize = 100;
  img.src = iconUrl;
  img.style.position = 'fixed';
  img.style.width = `${imgsize}px`;
  img.style.height = `${imgsize}px`;
  img.style.objectFit = 'contain';
  img.style.border = '1px solid #ccc';
  img.style.background = '#fff';
  img.style.zIndex = 9999;
  img.classList.add('hover-icon-preview');

  // Get viewport dimensions
  const padding = 10;
  const { clientX, clientY } = e;
  const maxX = window.innerWidth - imgsize - padding;
  const maxY = window.innerHeight - imgsize - padding;

  img.style.left = `${Math.min(clientX + 10, maxX)}px`;
  img.style.top = `${Math.min(clientY + 10, maxY)}px`;

  document.body.appendChild(img);

  node.addEventListener('mouseleave', () => {
    document.querySelectorAll('.hover-icon-preview').forEach(el => el.remove());
  }, { once: true });
});


function updateSidebarLayout() {
  const header = document.getElementById('header-container');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  const headerRect = header.getBoundingClientRect();

  // Clamp to viewport: headerRect.bottom is where the header *visually* ends
  const headerBottom = Math.max(0, Math.min(headerRect.bottom, window.innerHeight));

  sidebar.style.top = `${headerBottom}px`;
  sidebar.style.height = `calc(100vh - ${headerBottom}px - 2em)`;

  const sidebarWidth = sidebar.offsetWidth;

  overlay.style.left = `${sidebarWidth}px`;
  overlay.style.width = `calc(100% - ${sidebarWidth}px)`;
  overlay.style.top = `${headerBottom}px`;
  overlay.style.height = `calc(100vh - ${headerBottom}px)`;
}

// The overlay is positioned to start where the drawer ends, so it must be
// measured against the drawer's real width. That width changes after opening —
// the Tree of Life loads asynchronously and widens the panel — and the layout
// used to be computed once, before the panel was even expanded. The overlay
// then sat on top of the drawer's right-hand side, so clicking the right half of
// any drawer control closed the drawer instead of activating it. Re-measuring on
// every size change fixes it for the tree, for window resizes and for any
// control added to the drawer later.
if (typeof ResizeObserver !== 'undefined') {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    new ResizeObserver(() => {
      if (!sidebar.classList.contains('collapsed')) updateSidebarLayout();
    }).observe(sidebar);
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isOpening = sidebar.classList.contains('collapsed');

  sidebar.classList.toggle('collapsed');
  overlay.classList.toggle('hidden', sidebar.classList.contains('collapsed'));

  if (isOpening) {
    // After the class flip, so the panel has its expanded width to measure.
    updateSidebarLayout();
    ensureTreeLoaded();
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.add('collapsed');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

window.addEventListener('resize', () => {
  if (!document.getElementById('sidebar').classList.contains('collapsed')) {
    updateSidebarLayout();
  }
});

window.addEventListener('scroll', () => {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && !sidebar.classList.contains('collapsed')) {
    updateSidebarLayout();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

// The Tree-of-Life data (taxonomy.json + samples_info.json ≈ 1.16 MB) is only needed
// once the sidebar is opened, so fetch it lazily on first open instead of on every
// page load. Guarded so it runs at most once.
let treeLoadStarted = false;
function ensureTreeLoaded() {
  if (treeLoadStarted) return;
  treeLoadStarted = true;
  fetch(getBaseURL() + '/jsondata/taxonomy.json')
    .then((resp) => resp.json())
    .then(json => loadTaxonomyTree(json, null, null));
  fetch(getBaseURL() + '/jsondata/samples_info.json')
    .then((resp) => resp.json())
    .then(json => loadTaxonomyTree(null, json, null));
  fetchJSONCached(getBaseURL() + '/jsondata/taxa_icons.json')
    .then(json => loadTaxonomyTree(null, null, json))
    .catch(() => loadTaxonomyTree(null, null, {}));
}

// ---- Palette ----------------------------------------------------------------
// Light is the default. The site deliberately does not follow
// prefers-color-scheme: the parchment ground is the design rather than a
// daytime fallback, so the dark palette is something a reader asks for. The
// choice is remembered in localStorage under `theme` and applied before the
// first paint by the inline script in <head> (see head_lang.html), so switching
// pages never flashes the other palette.
(function () {
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const label = document.getElementById('theme-toggle-label');

  const render = (dark) => {
    button.setAttribute('aria-pressed', dark ? 'true' : 'false');
    // The button names the palette you would switch to, not the one you are in.
    if (label) label.textContent = dark ? button.dataset.labelLight : button.dataset.labelDark;
  };

  let dark = false;
  try {
    dark = localStorage.getItem('theme') === 'dark';
  } catch (e) {
    // Private browsing, or storage disabled: the toggle still works for this
    // page load, it just will not be remembered.
  }
  render(dark);

  button.addEventListener('click', () => {
    dark = !dark;
    if (dark) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch (e) { /* not remembered; see above */ }
    render(dark);
  });
})();
